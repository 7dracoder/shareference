import "server-only";
import crypto from "node:crypto";
import type { Hash } from "viem";
import { db, now } from "./db";
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

/** Methods a buyer can use for this listing: both provider AND platform must accept it. */
export function availableMethods(listing: Listing): PayMethod[] {
  const platform = platformPayoutMethods();
  const provider = listing.providerId ? getUserById(listing.providerId)?.payoutMethods ?? {} : platform;
  return PAY_METHODS.filter((m) => handleFor(platform, m) && handleFor(provider, m));
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
export function paymentLegs(payment: Payment): PayLeg[] {
  if (payment.method === "demo") return [];
  const platform = platformPayoutMethods();
  const legs: PayLeg[] = [];
  if (payment.providerId && payment.providerCents > 0) {
    const provider = getUserById(payment.providerId)?.payoutMethods ?? {};
    legs.push({
      recipient: "provider",
      label: `Provider (${aliasOf(payment.providerId)})`,
      handle: handleFor(provider, payment.method) ?? "",
      holderName: payment.method === "zelle" ? provider.zelleName : undefined,
      cents: payment.providerCents,
      confirmed: payment.providerConfirmedAt !== null,
    });
  }
  legs.push({
    recipient: "platform",
    label: payment.providerId ? "Switchboard platform fee" : "Switchboard",
    handle: handleFor(platform, payment.method) ?? "",
    holderName: payment.method === "zelle" ? platform.zelleName : undefined,
    cents: payment.feeCents,
    confirmed: payment.feeConfirmedAt !== null,
  });
  return legs;
}

function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `SB-${code}`;
}

export function purchaseAmountCents(listing: Listing, requestedCents: number): number {
  if (listing.kind === "seat") return listing.seatPriceCents;
  return Math.max(listing.minPurchaseCents, requestedCents);
}

export type CreateOrderResult = { ok: true; paymentId: string } | { ok: false; message: string };

export function createOrder(listing: Listing, buyer: User, requestedCents: number, method: PayMethod | "demo"): CreateOrderResult {
  if (listing.status !== "active") return { ok: false, message: "This listing is not available." };
  if (listing.providerId === buyer.id) return { ok: false, message: "You can't buy your own listing." };
  if (method === "demo" && !env.DEMO_MODE) return { ok: false, message: "Demo payments are disabled." };
  if (method !== "demo" && !availableMethods(listing).includes(method)) {
    return { ok: false, message: "That payment method isn't available for this listing." };
  }
  const gross = purchaseAmountCents(listing, requestedCents);
  const split = splitPayment(gross, listing.providerId === null);
  const id = newId("pay");
  db.prepare(
    `INSERT INTO payments (id, reference, listing_id, buyer_id, provider_id, gross_cents, fee_cents, provider_cents, method, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?)`,
  ).run(id, newReference(), listing.id, buyer.id, listing.providerId, split.grossCents, split.feeCents, split.providerCents, method, now());
  if (method === "demo") completeIfReady(id, { forceDemo: true });
  return { ok: true, paymentId: id };
}

export function getPayment(id: string): Payment | null {
  const row = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as PaymentRow | undefined;
  return row ? toPayment(row) : null;
}

export function paymentsForBuyer(buyerId: string): Payment[] {
  return (db.prepare("SELECT * FROM payments WHERE buyer_id = ? ORDER BY created_at DESC").all(buyerId) as PaymentRow[]).map(toPayment);
}

/** Orders where this provider still has to confirm their share arrived. */
export function pendingForProvider(providerId: string): Payment[] {
  return (
    db
      .prepare(
        "SELECT * FROM payments WHERE provider_id = ? AND status IN ('awaiting_payment','buyer_marked_sent') AND provider_confirmed_at IS NULL AND method != 'usdc' ORDER BY created_at DESC",
      )
      .all(providerId) as PaymentRow[]
  ).map(toPayment);
}

/** Orders where the platform (you) still has to confirm the fee arrived. */
export function pendingForPlatform(): Payment[] {
  return (
    db
      .prepare(
        "SELECT * FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent') AND fee_confirmed_at IS NULL AND method != 'usdc' ORDER BY created_at DESC",
      )
      .all() as PaymentRow[]
  ).map(toPayment);
}

export function markSent(paymentId: string, buyerId: string): boolean {
  const res = db
    .prepare("UPDATE payments SET status = 'buyer_marked_sent', buyer_marked_at = ? WHERE id = ? AND buyer_id = ? AND status = 'awaiting_payment'")
    .run(now(), paymentId, buyerId);
  if (res.changes > 0) {
    const p = getPayment(paymentId);
    if (p) agentLog("finance", "buyer marked sent", `${aliasOf(buyerId)} says they sent ${formatCents(p.grossCents)} for ${p.reference}. Waiting for recipients to confirm.`);
  }
  return res.changes > 0;
}

export function cancelOrder(paymentId: string, buyerId: string): boolean {
  const res = db
    .prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND buyer_id = ? AND status IN ('awaiting_payment','buyer_marked_sent') AND provider_confirmed_at IS NULL AND fee_confirmed_at IS NULL")
    .run(paymentId, buyerId);
  return res.changes > 0;
}

/** Provider confirms their share arrived in their own account. */
export function confirmProviderReceipt(paymentId: string, providerId: string): boolean {
  const res = db
    .prepare("UPDATE payments SET provider_confirmed_at = ? WHERE id = ? AND provider_id = ? AND provider_confirmed_at IS NULL AND status IN ('awaiting_payment','buyer_marked_sent')")
    .run(now(), paymentId, providerId);
  if (res.changes > 0) {
    agentLog("finance", "provider confirmed", `${aliasOf(providerId)} confirmed receipt for ${getPayment(paymentId)?.reference ?? paymentId}.`);
    completeIfReady(paymentId);
  }
  return res.changes > 0;
}

/** Platform admin confirms the 10% fee (or full pool price) arrived in their bank. */
export function confirmPlatformReceipt(paymentId: string, admin: User): boolean {
  if (!admin.isAdmin) return false;
  const res = db
    .prepare("UPDATE payments SET fee_confirmed_at = ? WHERE id = ? AND fee_confirmed_at IS NULL AND status IN ('awaiting_payment','buyer_marked_sent')")
    .run(now(), paymentId);
  if (res.changes > 0) {
    agentLog("finance", "fee confirmed", `Platform fee confirmed for ${getPayment(paymentId)?.reference ?? paymentId}.`);
    completeIfReady(paymentId);
  }
  return res.changes > 0;
}

function completeIfReady(paymentId: string, opts: { forceDemo?: boolean } = {}): void {
  const p = getPayment(paymentId);
  if (!p || p.status === "completed" || p.status === "canceled") return;
  const providerOk = !p.providerId || p.providerCents === 0 || p.providerConfirmedAt !== null;
  const feeOk = p.feeCents === 0 || p.feeConfirmedAt !== null;
  if (!opts.forceDemo && !(providerOk && feeOk)) return;
  const listing = getListing(p.listingId);
  if (!listing) return;

  db.transaction(() => {
    const claimed = db
      .prepare("UPDATE payments SET status = 'completed' WHERE id = ? AND status != 'completed'")
      .run(paymentId);
    if (claimed.changes === 0) return;
    const grant = createGrantFromPurchase(listing, p.buyerId, p.grossCents);
    db.prepare("UPDATE payments SET grant_id = ? WHERE id = ?").run(grant.id, paymentId);
  })();

  agentLog(
    "finance",
    opts.forceDemo ? "demo payment" : "payment completed",
    `${aliasOf(p.buyerId)} paid ${formatCents(p.grossCents)} for "${listing.title}" (${p.reference}). ` +
      (p.providerId
        ? `${formatCents(p.providerCents)} went directly to ${aliasOf(p.providerId)}, ${formatCents(p.feeCents)} platform fee.`
        : `${formatCents(p.feeCents)} went directly to Switchboard.`),
  );
}

export type UsdcSubmitResult = { ok: boolean; message: string };

/** Buyer submits tx hashes; we verify the transfers on-chain and complete instantly. */
export async function submitUsdcPayment(paymentId: string, buyerId: string, payer: string, hashes: Hash[]): Promise<UsdcSubmitResult> {
  const p = getPayment(paymentId);
  if (!p || p.buyerId !== buyerId) return { ok: false, message: "Order not found." };
  if (p.method !== "usdc") return { ok: false, message: "This order isn't a USDC order." };
  if (p.status === "completed") return { ok: true, message: "Already completed." };
  if (p.status === "canceled") return { ok: false, message: "This order was canceled." };

  const reused = hashes.find((h) => db.prepare("SELECT 1 FROM used_tx WHERE tx_hash = ?").get(h.toLowerCase()));
  if (reused) return { ok: false, message: `Transaction ${reused.slice(0, 10)}… was already used for another order.` };

  const legs = paymentLegs(p).map((l) => ({ to: l.handle, cents: l.cents }));
  const check = await verifyUsdcPayment(hashes, payer, legs, p.createdAt);
  if (!check.ok) return check;

  const t = now();
  db.transaction(() => {
    hashes.forEach((h) => db.prepare("INSERT INTO used_tx (tx_hash, payment_id, created_at) VALUES (?, ?, ?)").run(h.toLowerCase(), p.id, t));
    db.prepare("UPDATE payments SET payer_wallet = ?, provider_confirmed_at = ?, fee_confirmed_at = ? WHERE id = ?").run(payer, t, t, p.id);
  })();
  completeIfReady(p.id);
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

export function revenueSummary(): RevenueSummary {
  const real = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(gross_cents),0) AS gross, COALESCE(SUM(fee_cents),0) AS fee,
              COALESCE(SUM(provider_cents),0) AS provider, COUNT(DISTINCT buyer_id) AS buyers
       FROM payments WHERE status = 'completed' AND method != 'demo'`,
    )
    .get() as { orders: number; gross: number; fee: number; provider: number; buyers: number };
  const pending = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status IN ('awaiting_payment','buyer_marked_sent')").get() as { n: number };
  const demo = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'completed' AND method = 'demo'").get() as { n: number };
  return {
    grossCents: real.gross,
    platformCents: real.fee,
    providerCents: real.provider,
    orders: real.orders,
    pending: pending.n,
    demoOrders: demo.n,
    buyers: real.buyers,
  };
}
