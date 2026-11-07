import "server-only";
import crypto from "node:crypto";
import type { Hash } from "viem";
import { db, now, tx } from "./db";
import { darkbloomEnabled } from "./integrations/darkbloom";
import { tinfoilEnabled } from "./integrations/tinfoil";
import { env } from "./env";
import { newId } from "./crypto";
import { createGrantFromPurchase } from "./grants";
import { getListing, type Listing } from "./listings";
import { formatCents, splitPayment } from "./pricing";
import { aliasOf, getUserById, type PayoutMethods, type User } from "./users";
import { agentLog } from "./agents/log";
import { verifyUsdcPayment } from "./integrations/usdc";

/**
 * Direct payments, no middleman:
 *   buyer -> provider's own Zelle/Venmo/Cash App/PayPal/USDC   (90%)
 *   buyer -> platform's own Zelle/…/USDC                       (10% fee)
 * Each recipient confirms receipt (or the chain does, for USDC).
 * Access is issued only once every leg is confirmed.
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

/** The platform's own payout handles, from env. This is where your 10% lands. */
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

/** Methods the platform can take its fee with. Providers can only be paid through these. */
export function acceptedMethods(): PayMethod[] {
  const platform = platformPayoutMethods();
  return PAY_METHODS.filter((m) => (env.PLATFORM_FEE_BPS === 0 || handleFor(platform, m)) && (m !== "usdc" || env.NODE_ENV !== "production" || env.USDC_NETWORK === "base"));
}

/** True when the provider has at least one handle buyers can actually pay. */
export function canReceivePayments(methods: PayoutMethods): boolean {
  return acceptedMethods().some((m) => handleFor(methods, m));
}

/** Methods a buyer can use for this listing: both provider AND platform must accept it. */
export async function availableMethods(listing: Listing): Promise<PayMethod[]> {
  const platform = platformPayoutMethods();
  const provider = listing.providerId ? ((await getUserById(listing.providerId))?.payoutMethods ?? {}) : platform;
  return acceptedMethods().filter((m) => (listing.providerId || handleFor(platform, m)) && handleFor(provider, m));
}

export interface PayLeg {
  recipient: "provider" | "platform";
  label: string;
  handle: string;
  holderName?: string;
  cents: number;
  confirmed: boolean;
}

/** What the buyer must send, to whom. Only shown to the buyer of this order. */
export async function paymentLegs(payment: Payment): Promise<PayLeg[]> {
  if (payment.method === "demo") return [];
  const stored = await db.get<{ payment_legs: string | null }>("SELECT payment_legs FROM payments WHERE id = ?", [payment.id]);
  if (stored?.payment_legs) {
    const legs = JSON.parse(stored.payment_legs) as PayLeg[];
    return legs.map((leg) => ({ ...leg, confirmed: leg.recipient === "provider" ? payment.providerConfirmedAt !== null : payment.feeConfirmedAt !== null }));
  }
  const method = payment.method;
  const platform = platformPayoutMethods();
  const legs: PayLeg[] = [];
  if (payment.providerId && payment.providerCents > 0) {
    const provider = await getUserById(payment.providerId);
    const pm = provider?.payoutMethods ?? {};
    legs.push({
      recipient: "provider",
      label: `Provider (${provider?.alias ?? "unknown"})`,
      handle: handleFor(pm, method) ?? "",
      holderName: method === "zelle" ? pm.zelleName : undefined,
      cents: payment.providerCents,
      confirmed: payment.providerConfirmedAt !== null,
    });
  }
  if (payment.feeCents > 0) legs.push({
    recipient: "platform",
    label: payment.providerId ? "Shareference platform fee" : "Shareference",
    handle: handleFor(platform, method) ?? "",
    holderName: method === "zelle" ? platform.zelleName : undefined,
    cents: payment.feeCents,
    confirmed: payment.feeConfirmedAt !== null,
  });
  return legs;
}

function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `SHR-${code}`;
}

export function purchaseAmountCents(listing: Listing, requestedCents: number): number {
  if (listing.kind === "seat") return listing.seatPriceCents;
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
  if (listing.kind === "pool" && !env.DEMO_MODE && !darkbloomEnabled() && !tinfoilEnabled()) return { ok: false, message: "Pool chat is being connected. Please choose a provider listing." };
  if (listing.kind === "seat" && (!options.deliveryEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.deliveryEmail) || options.deliveryEmail.length > 254)) return { ok: false, message: "Enter the email to invite to the team seat." };
  if (listing.status !== "active") return { ok: false, message: "This listing is not available." };
  if (listing.providerId === buyer.id) return { ok: false, message: "You can't buy your own listing." };
  if (method === "demo" && !env.DEMO_MODE) return { ok: false, message: "Demo payments are disabled." };
  if (method !== "demo" && !(await availableMethods(listing)).includes(method)) {
    return { ok: false, message: "That payment method isn't available for this listing." };
  }
  const gross = purchaseAmountCents(listing, requestedCents);
  const split = splitPayment(gross, listing.providerId === null);
  const id = newId("pay");
  const initial: Payment = { id, reference: newReference(), listingId: listing.id, buyerId: buyer.id, providerId: listing.providerId, ...split, method, status: "awaiting_payment", providerConfirmedAt: null, feeConfirmedAt: null, buyerMarkedAt: null, grantId: null, createdAt: now(), deliveryEmail: options.deliveryEmail ?? null };
  const legs = await paymentLegs(initial);
  await db.run(
    `INSERT INTO payments (id, reference, listing_id, buyer_id, provider_id, gross_cents, fee_cents, provider_cents, method, status, created_at, listing_snapshot, payment_legs, checkout_key, delivery_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?) ON CONFLICT (buyer_id, checkout_key) DO NOTHING`,
    [id, initial.reference, listing.id, buyer.id, listing.providerId, split.grossCents, split.feeCents, split.providerCents, method, initial.createdAt, JSON.stringify(listing), JSON.stringify(legs), options.checkoutKey ?? null, options.deliveryEmail ?? null],
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

/** Orders where this provider still has to confirm their share arrived. */
export async function pendingForProvider(providerId: string): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>(
    `SELECT * FROM payments WHERE provider_id = ? AND status IN ('awaiting_payment','buyer_marked_sent')
     AND provider_confirmed_at IS NULL AND method NOT IN ('usdc','demo') ORDER BY created_at DESC`,
    [providerId],
  );
  return rows.map(toPayment);
}

/** Orders where the platform (you) still has to confirm the fee arrived. */
export async function pendingForPlatform(): Promise<Payment[]> {
  const rows = await db.all<PaymentRow>(
    `SELECT * FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent')
     AND fee_confirmed_at IS NULL AND method NOT IN ('usdc','demo') ORDER BY created_at DESC`,
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
        `${await aliasOf(buyerId)} says they sent ${formatCents(p.grossCents)} for ${p.reference}. Waiting for recipients to confirm.`,
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

/** Provider confirms their share arrived in their own account. */
export async function confirmProviderReceipt(paymentId: string, providerId: string): Promise<boolean> {
  const changes = await db.run(
    `UPDATE payments SET provider_confirmed_at = ? WHERE id = ? AND provider_id = ? AND provider_confirmed_at IS NULL
     AND status IN ('awaiting_payment','buyer_marked_sent')`,
    [now(), paymentId, providerId],
  );
  if (changes > 0) {
    const p = await getPayment(paymentId);
    await agentLog("finance", "provider confirmed", `${await aliasOf(providerId)} confirmed receipt for ${p?.reference ?? paymentId}.`);
  }
  await completeIfReady(paymentId);
  return changes > 0;
}

/** Platform admin confirms the 10% fee (or full pool price) arrived in their bank. */
export async function confirmPlatformReceipt(paymentId: string, admin: User): Promise<boolean> {
  if (!admin.isAdmin) return false;
  const changes = await db.run(
    "UPDATE payments SET fee_confirmed_at = ? WHERE id = ? AND fee_confirmed_at IS NULL AND status IN ('awaiting_payment','buyer_marked_sent')",
    [now(), paymentId],
  );
  if (changes > 0) {
    const p = await getPayment(paymentId);
    await agentLog("finance", "fee confirmed", `Platform fee confirmed for ${p?.reference ?? paymentId}.`);
  }
  await completeIfReady(paymentId);
  return changes > 0;
}

async function completeIfReady(paymentId: string, opts: { forceDemo?: boolean } = {}): Promise<void> {
  const context = await tx(async (t) => {
    const row = await t.get<PaymentRow>("SELECT * FROM payments WHERE id = ? FOR UPDATE", [paymentId]);
    if (!row || row.status === "completed" || row.status === "canceled") return null;
    const p = toPayment(row);
    const providerOk = !p.providerId || p.providerCents === 0 || p.providerConfirmedAt !== null;
    const feeOk = p.feeCents === 0 || p.feeConfirmedAt !== null;
    const demo = opts.forceDemo && p.method === "demo" && env.DEMO_MODE;
    if (!demo && !(providerOk && feeOk)) return null;
    const listing = row.listing_snapshot ? JSON.parse(row.listing_snapshot) as Listing : await getListing(p.listingId);
    if (!listing) throw new Error("Order listing is missing");
    const grantId = await createGrantFromPurchase(listing, p.buyerId, p.grossCents, t);
    await t.run("UPDATE grants SET delivery_email = ? WHERE id = ?", [p.deliveryEmail, grantId]);
    await t.run("UPDATE payments SET status = 'completed', grant_id = ? WHERE id = ?", [grantId, paymentId]);
    return { p, listing };
  });
  if (!context) return;
  const { p, listing } = context;
  const issued = true;
  if (!issued) return;

  const [buyerAlias, providerAlias] = await Promise.all([aliasOf(p.buyerId), aliasOf(p.providerId)]);
  await agentLog(
    "finance",
    opts.forceDemo ? "demo payment" : "payment completed",
    `${buyerAlias} paid ${formatCents(p.grossCents)} for "${listing.title}" (${p.reference}). ` +
      (p.providerId
        ? `${formatCents(p.providerCents)} went directly to ${providerAlias}, ${formatCents(p.feeCents)} platform fee.`
        : `${formatCents(p.feeCents)} went directly to Shareference.`),
  );
  if (listing.kind === "seat") {
    await agentLog("enforcer", "seat requested", `${buyerAlias} bought ${listing.seatMinutes} min of ${listing.service}. Waiting for ${providerAlias} to assign the seat.`);
  }
}

export type UsdcSubmitResult = { ok: boolean; message: string };

/** Buyer submits tx hashes; we verify the transfers on-chain and complete instantly. */
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

  const legs = (await paymentLegs(p)).map((l) => ({ to: l.handle, cents: l.cents }));
  const check = await verifyUsdcPayment(hashes, payer, legs, p.createdAt);
  if (!check.ok) return check;

  const ts = now();
  try {
    await tx(async (t) => {
      const locked = await t.get<{ status: string }>("SELECT status FROM payments WHERE id = ? FOR UPDATE", [p.id]);
      if (!locked || locked.status === "canceled") throw new Error("Order was canceled");
      for (const h of hashes) {
        await t.run("INSERT INTO used_tx (tx_hash, payment_id, created_at) VALUES (?, ?, ?)", [h.toLowerCase(), p.id, ts]);
      }
      await t.run("UPDATE payments SET payer_wallet = ?, provider_confirmed_at = ?, fee_confirmed_at = ? WHERE id = ?", [payer, ts, ts, p.id]);
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
}

export async function revenueSummary(): Promise<RevenueSummary> {
  const [real, pending, demo] = await Promise.all([
    db.get<{ orders: number; gross: number; fee: number; provider: number; buyers: number }>(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(gross_cents),0) AS gross, COALESCE(SUM(fee_cents),0) AS fee,
              COALESCE(SUM(provider_cents),0) AS provider, COUNT(DISTINCT buyer_id) AS buyers
       FROM payments WHERE status = 'completed' AND method != 'demo'`,
    ),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent')"),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed' AND method = 'demo'"),
  ]);
  return {
    grossCents: real?.gross ?? 0,
    platformCents: real?.fee ?? 0,
    providerCents: real?.provider ?? 0,
    orders: real?.orders ?? 0,
    pending: pending?.n ?? 0,
    demoOrders: demo?.n ?? 0,
    buyers: real?.buyers ?? 0,
  };
}
