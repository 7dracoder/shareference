import "server-only";
import crypto from "node:crypto";
import type { Hash } from "viem";
import { db, now, tx } from "./db";
import { darkbloomEnabled } from "./integrations/darkbloom";
import { tinfoilEnabled } from "./integrations/tinfoil";
import { openrouterEnabled } from "./integrations/openrouter";
import { env } from "./env";
import { newId } from "./crypto";
import { createGrantFromPurchase } from "./grants";
import { getListing, type Listing } from "./listings";
import { formatCents, splitPayment } from "./pricing";
import { aliasOf, getUserById, type PayoutMethods, type User } from "./users";
import { agentLog } from "./agents/log";
import { verifyUsdcPayment } from "./integrations/usdc";

/**
 * Money flow:
 *   1. Buyer pays the full amount to the platform (Zelle QR on the order page).
 *   2. Admin confirms the deposit → access is issued.
 *   3. Admin sends the provider their share from the platform account, then marks it paid.
 * Buyers never see the provider's payout handle.
 */
export type PayMethod = "zelle" | "venmo" | "cashapp" | "paypal" | "usdc";
export const PAY_METHODS: readonly PayMethod[] = ["zelle", "venmo", "cashapp", "paypal", "usdc"] as const;

export const METHOD_LABEL: Record<PayMethod, string> = {
  zelle: "Zelle",
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
  usdc: "USDC (Base)",
};

export type PaymentStatus = "awaiting_payment" | "buyer_marked_sent" | "completed" | "canceled";

export interface Payment {
  id: string;
  reference: string;
  listingId: string;
  buyerId: string;
  providerId: string | null;
  grossCents: number;
  feeCents: number;
  providerCents: number;
  method: PayMethod | "demo";
  status: PaymentStatus;
  providerConfirmedAt: number | null;
  feeConfirmedAt: number | null;
  buyerMarkedAt: number | null;
  grantId: string | null;
  createdAt: number;
  deliveryEmail: string | null;
}

interface PaymentRow {
  id: string;
  reference: string;
  listing_id: string;
  buyer_id: string;
  provider_id: string | null;
  gross_cents: number;
  fee_cents: number;
  provider_cents: number;
  method: PayMethod | "demo";
  status: PaymentStatus;
  provider_confirmed_at: number | null;
  fee_confirmed_at: number | null;
  buyer_marked_at: number | null;
  grant_id: string | null;
  created_at: number;
  listing_snapshot?: string | null;
  payment_legs?: string | null;
  delivery_email?: string | null;
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    reference: r.reference,
    listingId: r.listing_id,
    buyerId: r.buyer_id,
    providerId: r.provider_id,
    grossCents: r.gross_cents,
    feeCents: r.fee_cents,
    providerCents: r.provider_cents,
    method: r.method,
    status: r.status,
    providerConfirmedAt: r.provider_confirmed_at,
    feeConfirmedAt: r.fee_confirmed_at,
    buyerMarkedAt: r.buyer_marked_at,
    grantId: r.grant_id,
    createdAt: r.created_at,
    deliveryEmail: r.delivery_email ?? null,
  };
}

/** The platform's own payout handles, from env. Buyers pay here; providers are paid from here. */
export function platformPayoutMethods(): PayoutMethods {
  return {
    zelle: env.PLATFORM_ZELLE,
    zelleName: env.PLATFORM_ZELLE_NAME,
    venmo: env.PLATFORM_VENMO,
    cashapp: env.PLATFORM_CASHAPP,
    paypal: env.PLATFORM_PAYPAL,
    usdc: env.PLATFORM_USDC_ADDRESS,
  };
}

function handleFor(methods: PayoutMethods, method: PayMethod): string | undefined {
  return methods[method];
}

/** Methods the platform can collect with. Checkout currently surfaces Zelle first. */
export function acceptedMethods(): PayMethod[] {
  const platform = platformPayoutMethods();
  return PAY_METHODS.filter((m) => (env.PLATFORM_FEE_BPS === 0 || handleFor(platform, m)) && (m !== "usdc" || env.NODE_ENV !== "production" || env.USDC_NETWORK === "base"));
}

/** True when the provider has at least one handle the platform can pay out to. */
export function canReceivePayments(methods: PayoutMethods): boolean {
  return acceptedMethods().some((m) => handleFor(methods, m));
}

/** Methods a buyer can use: platform must accept it. Provider handles are never shown to buyers. */
export async function availableMethods(listing: Listing): Promise<PayMethod[]> {
  void listing;
  // Zelle is the supported buyer path (QR on the order page). Other platform methods stay available for admin payouts.
  return acceptedMethods().filter((m) => m === "zelle" || m === "usdc");
}

export interface PayLeg {
  recipient: "provider" | "platform";
  label: string;
  handle: string;
  holderName?: string;
  cents: number;
  confirmed: boolean;
}

/** Snapshot of where the buyer should send money: the platform only, for the full amount. */
export function platformCollectionLeg(payment: Payment): PayLeg | null {
  if (payment.method === "demo") return null;
  const platform = platformPayoutMethods();
  const handle = handleFor(platform, payment.method as PayMethod);
  if (!handle) return null;
  return {
    recipient: "platform",
    label: "Shareference",
    handle,
    holderName: payment.method === "zelle" ? platform.zelleName : undefined,
    cents: payment.grossCents,
    confirmed: payment.feeConfirmedAt !== null,
  };
}

/** @deprecated Prefer platformCollectionLeg. Kept for older tests that read payment_legs. */
export async function paymentLegs(payment: Payment): Promise<PayLeg[]> {
  if (payment.method === "demo") return [];
  const stored = await db.get<{ payment_legs: string | null }>("SELECT payment_legs FROM payments WHERE id = ?", [payment.id]);
  if (stored?.payment_legs) {
    const legs = JSON.parse(stored.payment_legs) as PayLeg[];
    // New orders store a single platform leg for the full amount.
    if (legs.length === 1 && legs[0]?.recipient === "platform") {
      return [{ ...legs[0], cents: payment.grossCents, confirmed: payment.feeConfirmedAt !== null }];
    }
  }
  const leg = platformCollectionLeg(payment);
  return leg ? [leg] : [];
}

/** Admin-only: how to pay the provider their share after the buyer deposit clears. */
export async function providerPayoutDetails(payment: Payment): Promise<{ method: PayMethod; handle: string; holderName?: string; cents: number; alias: string } | null> {
  if (!payment.providerId || payment.providerCents <= 0) return null;
  const provider = await getUserById(payment.providerId);
  if (!provider) return null;
  const pm = provider.payoutMethods;
  const method = (acceptedMethods().find((m) => handleFor(pm, m)) ?? null) as PayMethod | null;
  if (!method) return null;
  return {
    method,
    handle: handleFor(pm, method)!,
    holderName: method === "zelle" ? pm.zelleName : undefined,
    cents: payment.providerCents,
    alias: provider.alias,
  };
}

function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `SHR-${code}`;
}

export function purchaseAmountCents(listing: Listing, requestedCents: number): number {
  if (listing.kind === "seat") return listing.seatPriceCents;
  if (listing.kind === "compute") return Math.max(1, Math.round(requestedCents / listing.seatPriceCents)) * listing.seatPriceCents;
  return Math.max(listing.minPurchaseCents, requestedCents);
}

export type CreateOrderResult = { ok: true; paymentId: string } | { ok: false; message: string };

export async function createOrder(listing: Listing, buyer: User, requestedCents: number, method: PayMethod | "demo", options: { checkoutKey?: string; deliveryEmail?: string } = {}): Promise<CreateOrderResult> {
  if (!Number.isSafeInteger(requestedCents) || requestedCents < 0 || requestedCents > 50_000) return { ok: false, message: "Choose an amount up to $500." };
  if (options.checkoutKey && !/^[a-f0-9-]{36}$/i.test(options.checkoutKey)) return { ok: false, message: "Please reload checkout and try again." };
  if (options.checkoutKey) {
    const existing = await db.get<{ id: string }>("SELECT id FROM payments WHERE buyer_id = ? AND checkout_key = ?", [buyer.id, options.checkoutKey]);
    if (existing) return { ok: true, paymentId: existing.id };
  }
  const latest = await getListing(listing.id);
  if (!latest) return { ok: false, message: "This listing is no longer available." };
  listing = latest;
  if (listing.kind === "pool" && !env.DEMO_MODE && !openrouterEnabled() && !darkbloomEnabled() && !tinfoilEnabled()) return { ok: false, message: "Pool chat is being connected. Please choose a provider listing." };
  if (listing.kind === "seat" && (!options.deliveryEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.deliveryEmail) || options.deliveryEmail.length > 254)) return { ok: false, message: "Enter the email to invite to the team seat." };
  if (listing.status !== "active") return { ok: false, message: "This listing is not available." };
  if (listing.providerId === buyer.id) return { ok: false, message: "You can't buy your own listing." };
  if (method === "demo" && !env.DEMO_MODE) return { ok: false, message: "Demo payments are disabled." };
  if (method !== "demo" && !(await availableMethods(listing)).includes(method)) {
    return { ok: false, message: "That payment method isn't available right now." };
  }
  if (listing.providerId) {
    const provider = await getUserById(listing.providerId);
    if (!provider || !canReceivePayments(provider.payoutMethods)) {
      return { ok: false, message: "This listing isn't ready to take payments yet." };
    }
  }
  const gross = purchaseAmountCents(listing, requestedCents);
  const split = splitPayment(gross, listing.providerId === null);
  const id = newId("pay");
  const initial: Payment = { id, reference: newReference(), listingId: listing.id, buyerId: buyer.id, providerId: listing.providerId, ...split, method, status: "awaiting_payment", providerConfirmedAt: null, feeConfirmedAt: null, buyerMarkedAt: null, grantId: null, createdAt: now(), deliveryEmail: options.deliveryEmail ?? null };
  const leg = platformCollectionLeg(initial);
  await db.run(
    `INSERT INTO payments (id, reference, listing_id, buyer_id, provider_id, gross_cents, fee_cents, provider_cents, method, status, created_at, listing_snapshot, payment_legs, checkout_key, delivery_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?) ON CONFLICT (buyer_id, checkout_key) DO NOTHING`,
    [id, initial.reference, listing.id, buyer.id, listing.providerId, split.grossCents, split.feeCents, split.providerCents, method, initial.createdAt, JSON.stringify(listing), leg ? JSON.stringify([leg]) : null, options.checkoutKey ?? null, options.deliveryEmail ?? null],
  );
  const savedId = options.checkoutKey ? (await db.get<{ id: string }>("SELECT id FROM payments WHERE buyer_id = ? AND checkout_key = ?", [buyer.id, options.checkoutKey]))?.id ?? id : id;
  if (method === "demo") await completeIfReady(savedId, { forceDemo: true });
  return { ok: true, paymentId: savedId };
}

export async function getPayment(id: string): Promise<Payment | null> {
  const row = await db.get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [id]);
  return row ? toPayment(row) : null;
}

export async function paymentsForBuyer(buyerId: string): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>("SELECT * FROM payments WHERE buyer_id = ? ORDER BY created_at DESC", [buyerId]);
  return rows.map(toPayment);
}

/** Provider view: payouts the platform still owes them (access may already be live). */
export async function pendingPayoutsForProvider(providerId: string): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>(
    `SELECT * FROM payments WHERE provider_id = ? AND status = 'completed'
     AND provider_cents > 0 AND provider_confirmed_at IS NULL AND method != 'demo'
     ORDER BY created_at DESC`,
    [providerId],
  );
  return rows.map(toPayment);
}

/** Orders where the platform still has to confirm the buyer's Zelle deposit. */
export async function pendingForPlatform(): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>(
    `SELECT * FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent')
     AND fee_confirmed_at IS NULL AND method NOT IN ('usdc','demo') ORDER BY created_at DESC`,
  );
  return rows.map(toPayment);
}

/** Completed sales where the admin still needs to send the provider their share. */
export async function pendingProviderPayouts(): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>(
    `SELECT * FROM payments WHERE status = 'completed' AND provider_id IS NOT NULL
     AND provider_cents > 0 AND provider_confirmed_at IS NULL AND method != 'demo'
     ORDER BY created_at DESC`,
  );
  return rows.map(toPayment);
}

export async function markSent(paymentId: string, buyerId: string): Promise<boolean> {
  const changes = await db.run(
    "UPDATE payments SET status = 'buyer_marked_sent', buyer_marked_at = ? WHERE id = ? AND buyer_id = ? AND status = 'awaiting_payment'",
    [now(), paymentId, buyerId],
  );
  if (changes > 0) {
    const p = await getPayment(paymentId);
    if (p) {
      await agentLog(
        "finance",
        "buyer marked sent",
        `${await aliasOf(buyerId)} says they sent ${formatCents(p.grossCents)} for ${p.reference}. Waiting for Shareference to confirm.`,
      );
    }
  }
  return changes > 0;
}

export async function cancelOrder(paymentId: string, buyerId: string): Promise<boolean> {
  const changes = await db.run(
    `UPDATE payments SET status = 'canceled' WHERE id = ? AND buyer_id = ? AND status = 'awaiting_payment'
     AND buyer_marked_at IS NULL AND provider_confirmed_at IS NULL AND fee_confirmed_at IS NULL`,
    [paymentId, buyerId],
  );
  return changes > 0;
}

/** Admin confirms the buyer's full payment arrived → access is issued. */
export async function confirmPlatformReceipt(paymentId: string, admin: User): Promise<boolean> {
  if (!admin.isAdmin) return false;
  const changes = await db.run(
    "UPDATE payments SET fee_confirmed_at = ? WHERE id = ? AND fee_confirmed_at IS NULL AND status IN ('awaiting_payment','buyer_marked_sent')",
    [now(), paymentId],
  );
  if (changes > 0) {
    const p = await getPayment(paymentId);
    await agentLog("finance", "payment received", `Shareference confirmed ${formatCents(p?.grossCents ?? 0)} for ${p?.reference ?? paymentId}.`);
  }
  await completeIfReady(paymentId);
  return changes > 0;
}

/** Admin marks that the provider's share was sent from the platform account. */
export async function markProviderPaid(paymentId: string, admin: User): Promise<boolean> {
  if (!admin.isAdmin) return false;
  const changes = await db.run(
    `UPDATE payments SET provider_confirmed_at = ? WHERE id = ? AND provider_id IS NOT NULL
     AND provider_cents > 0 AND provider_confirmed_at IS NULL AND status = 'completed'`,
    [now(), paymentId],
  );
  if (changes > 0) {
    const p = await getPayment(paymentId);
    if (p?.providerId) {
      await agentLog("finance", "provider paid", `Paid ${formatCents(p.providerCents)} to ${await aliasOf(p.providerId)} for ${p.reference}.`);
    }
  }
  return changes > 0;
}

/** @deprecated Use markProviderPaid. Kept so older scripts keep compiling until removed. */
export async function confirmProviderReceipt(paymentId: string, providerId: string): Promise<boolean> {
  // Providers no longer confirm buyer transfers. Ignore and do not unlock access.
  void paymentId;
  void providerId;
  return false;
}

async function completeIfReady(paymentId: string, opts: { forceDemo?: boolean } = {}): Promise<void> {
  const context = await tx(async (t) => {
    const row = await t.get<PaymentRow>("SELECT * FROM payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!row || row.status === "completed" || row.status === "canceled") return null;
    const p = toPayment(row);
    const demo = opts.forceDemo && p.method === "demo" && env.DEMO_MODE;
    // Access unlocks when the platform has the buyer's money. Paying the provider is a later admin step.
    if (!demo && p.feeConfirmedAt === null) return null;
    const listing = row.listing_snapshot ? JSON.parse(row.listing_snapshot) as Listing : await getListing(p.listingId);
    if (!listing) throw new Error("Order listing is missing");
    const grantId = await createGrantFromPurchase(listing, p.buyerId, p.grossCents, t);
    await t.run("UPDATE grants SET delivery_email = ? WHERE id = ?", [p.deliveryEmail, grantId]);
    await t.run("UPDATE payments SET status = 'completed', grant_id = ? WHERE id = ?", [grantId, paymentId]);
    return { p, listing };
  });
  if (!context) return;
  const { p, listing } = context;

  const [buyerAlias, providerAlias] = await Promise.all([aliasOf(p.buyerId), aliasOf(p.providerId)]);
  await agentLog(
    "finance",
    opts.forceDemo ? "demo payment" : "payment completed",
    `${buyerAlias} paid ${formatCents(p.grossCents)} for "${listing.title}" (${p.reference}). ` +
      (p.providerId
        ? `Access issued. ${formatCents(p.providerCents)} still owed to ${providerAlias}; platform keeps ${formatCents(p.feeCents)}.`
        : `Access issued. ${formatCents(p.grossCents)} to Shareference.`),
  );
  if (listing.kind === "seat") {
    await agentLog("enforcer", "seat requested", `${buyerAlias} bought ${listing.seatMinutes} min of ${listing.service}. Waiting for ${providerAlias} to assign the seat.`);
  }
}

export type UsdcSubmitResult = { ok: boolean; message: string };

/** Buyer submits tx hashes; we verify a single transfer of the full amount to the platform. */
export async function submitUsdcPayment(paymentId: string, buyerId: string, payer: string, hashes: Hash[]): Promise<UsdcSubmitResult> {
  const p = await getPayment(paymentId);
  if (!p || p.buyerId !== buyerId) return { ok: false, message: "Order not found." };
  if (p.method !== "usdc") return { ok: false, message: "This order isn't a USDC order." };
  if (p.status === "completed") return { ok: true, message: "Already completed." };
  if (p.status === "canceled") return { ok: false, message: "This order was canceled." };

  for (const h of hashes) {
    if (await db.get("SELECT 1 FROM used_tx WHERE tx_hash = ?", [h.toLowerCase()])) {
      return { ok: false, message: `Transaction ${h.slice(0, 10)}… was already used for another order.` };
    }
  }

  const leg = platformCollectionLeg(p);
  if (!leg) return { ok: false, message: "USDC payouts aren't configured." };
  const check = await verifyUsdcPayment(hashes, payer, [{ to: leg.handle, cents: leg.cents }], p.createdAt);
  if (!check.ok) return check;

  const ts = now();
  try {
    await tx(async (t) => {
      const locked = await t.get<{ status: string }>("SELECT status FROM payments WHERE id = ? FOR UPDATE", [p.id]);
      if (!locked || locked.status === "canceled") throw new Error("Order was canceled");
      for (const h of hashes) {
        await t.run("INSERT INTO used_tx (tx_hash, payment_id, created_at) VALUES (?, ?, ?)", [h.toLowerCase(), p.id, ts]);
      }
      await t.run("UPDATE payments SET payer_wallet = ?, fee_confirmed_at = ? WHERE id = ?", [payer, ts, p.id]);
    });
  } catch {
    return { ok: false, message: "That transaction was just used for another order." };
  }
  await completeIfReady(p.id);
  return { ok: true, message: check.message };
}

export interface RevenueSummary {
  grossCents: number;
  platformCents: number;
  providerCents: number;
  orders: number;
  pending: number;
  demoOrders: number;
  buyers: number;
  unpaidProviders: number;
}

export async function revenueSummary(): Promise<RevenueSummary> {
  const [real, pending, demo, unpaid] = await Promise.all([
    db.get<{ orders: number; gross: number; fee: number; provider: number; buyers: number }>(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(gross_cents),0) AS gross, COALESCE(SUM(fee_cents),0) AS fee,
              COALESCE(SUM(provider_cents),0) AS provider, COUNT(DISTINCT buyer_id) AS buyers
       FROM payments WHERE status = 'completed' AND method != 'demo'`,
    ),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent')"),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed' AND method = 'demo'"),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed' AND provider_cents > 0 AND provider_confirmed_at IS NULL AND method != 'demo'"),
  ]);
  return {
    grossCents: real?.gross ?? 0,
    platformCents: real?.fee ?? 0,
    providerCents: real?.provider ?? 0,
    orders: real?.orders ?? 0,
    pending: pending?.n ?? 0,
    demoOrders: demo?.n ?? 0,
    buyers: real?.buyers ?? 0,
    unpaidProviders: unpaid?.n ?? 0,
  };
}
