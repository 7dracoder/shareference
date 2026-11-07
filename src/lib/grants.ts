import "server-only";
import { db, now, parseJsonArray, tx, type Db } from "./db";
import { hashToken, issueApiKey, newId, openSecret, sealSecret } from "./crypto";
import { MICROS_PER_CENT, type Tier } from "./pricing";
import type { Listing } from "./listings";
import { aliasMap, aliasFrom, aliasOf } from "./users";
import { agentLog } from "./agents/log";

export type GrantStatus = "pending_assignment" | "active" | "revoked" | "expired" | "exhausted";

export interface Grant {
  id: string;
  listingId: string;
  buyerId: string;
  providerId: string | null;
  keyPrefix: string | null;
  features: string[];
  models: string[];
  budgetMicros: number;
  spentMicros: number;
  maxRpm: number;
  maxTokensPerRequest: number;
  privacyFloor: Tier;
  startsAt: number;
  expiresAt: number | null;
  status: GrantStatus;
  createdAt: number;
  deliveryEmail: string | null;
}

interface GrantRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  provider_id: string | null;
  key_prefix: string | null;
  features: string;
  models: string;
  budget_micros: number;
  spent_micros: number;
  max_rpm: number;
  max_tokens_per_request: number;
  privacy_floor: Tier;
  starts_at: number;
  expires_at: number | null;
  status: GrantStatus;
  created_at: number;
  delivery_email: string | null;
}

const COLUMNS =
  "id, listing_id, buyer_id, provider_id, key_prefix, features, models, budget_micros, spent_micros, max_rpm, max_tokens_per_request, privacy_floor, starts_at, expires_at, status, created_at, delivery_email";

function toGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    providerId: row.provider_id,
    keyPrefix: row.key_prefix,
    features: parseJsonArray(row.features),
    models: parseJsonArray(row.models),
    budgetMicros: row.budget_micros,
    spentMicros: row.spent_micros,
    maxRpm: row.max_rpm,
    maxTokensPerRequest: row.max_tokens_per_request,
    privacyFloor: row.privacy_floor,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    deliveryEmail: row.delivery_email,
  };
}

const DEFAULT_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Creates the access grant a buyer receives after paying. Pass `t` to run inside a transaction. */
export async function createGrantFromPurchase(listing: Listing, buyerId: string, grossCents: number, t: Db = db): Promise<string> {
  const id = newId("gr");
  const ts = now();
  const isSeat = listing.kind === "seat";
  const key = isSeat ? null : issueApiKey();
  // Computer time is sold in blocks of seatMinutes; the key stops working when the time is used up.
  const expiresAt = listing.kind === "compute"
    ? ts + Math.max(1, Math.round(grossCents / listing.seatPriceCents)) * listing.seatMinutes * 60_000
    : ts + DEFAULT_KEY_TTL_MS;
  await t.run(
    `INSERT INTO grants
      (id, listing_id, buyer_id, provider_id, key_hash, key_prefix, key_ciphertext, features, models,
       budget_micros, spent_micros, max_rpm, max_tokens_per_request, privacy_floor, starts_at, expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'fast', ?, ?, ?, ?)`,
    [
      id,
      listing.id,
      buyerId,
      listing.providerId,
      key?.hash ?? null,
      key?.prefix ?? null,
      key ? sealSecret(key.key) : null,
      JSON.stringify(listing.features),
      JSON.stringify(listing.models),
      isSeat || listing.kind === "compute" ? 0 : grossCents * MICROS_PER_CENT,
      listing.maxRpm,
      listing.maxTokensPerRequest,
      ts,
      isSeat ? null : expiresAt,
      isSeat ? "pending_assignment" : "active",
      ts,
    ],
  );
  return id;
}

export async function getGrant(id: string): Promise<Grant | null> {
  const row = await db.get<GrantRow>(`SELECT ${COLUMNS} FROM grants WHERE id = ?`, [id]);
  return row ? toGrant(row) : null;
}

export async function grantByKey(apiKey: string): Promise<Grant | null> {
  const row = await db.get<GrantRow>(`SELECT ${COLUMNS} FROM grants WHERE key_hash = ?`, [hashToken(apiKey)]);
  return row ? toGrant(row) : null;
}

/** Only the buyer who owns the grant may reveal its key. */
export async function revealKey(grantId: string, buyerId: string): Promise<string | null> {
  const row = await db.get<{ key_ciphertext: string | null }>("SELECT key_ciphertext FROM grants WHERE id = ? AND buyer_id = ?", [
    grantId,
    buyerId,
  ]);
  return row?.key_ciphertext ? openSecret(row.key_ciphertext) : null;
}

export async function grantsForBuyer(buyerId: string): Promise<Grant[]> {
  await sweepExpired();
  const rows = await db.all<GrantRow>(`SELECT ${COLUMNS} FROM grants WHERE buyer_id = ? ORDER BY created_at DESC`, [buyerId]);
  return rows.map(toGrant);
}

export async function grantsForProvider(providerId: string): Promise<Grant[]> {
  await sweepExpired();
  const rows = await db.all<GrantRow>(`SELECT ${COLUMNS} FROM grants WHERE provider_id = ? ORDER BY created_at DESC`, [providerId]);
  return rows.map(toGrant);
}

function isParty(grant: Grant, userId: string): boolean {
  return grant.buyerId === userId || grant.providerId === userId;
}

/** Kill switch. Either the owner (provider) or the buyer can end a grant. */
export async function revokeGrant(grantId: string, actorId: string): Promise<boolean> {
  const grant = await getGrant(grantId);
  if (!grant || !isParty(grant, actorId) || grant.status === "revoked") return false;
  await db.run("UPDATE grants SET status = 'revoked' WHERE id = ?", [grantId]);
  await agentLog("enforcer", "grant revoked", `${await aliasOf(actorId)} revoked grant ${grantId.slice(0, 10)}.`);
  return true;
}

export interface LimitUpdate {
  maxRpm: number;
  maxTokensPerRequest: number;
  privacyFloor: Tier;
  expiresAt: number | null;
}

/** Only the owner (provider) sets limits. Pool grants are owned by the buyer. */
export async function updateLimits(grantId: string, actorId: string, update: LimitUpdate): Promise<boolean> {
  const grant = await getGrant(grantId);
  if (!grant) return false;
  const isOwner = grant.providerId ? grant.providerId === actorId : grant.buyerId === actorId;
  if (!isOwner || grant.status !== "active") return false;
  const listing = await import("./listings").then((m) => m.getListing(grant.listingId));
  if (!listing || update.maxRpm > listing.maxRpm || update.maxTokensPerRequest > listing.maxTokensPerRequest) return false;
  const ceiling = listing.kind === "compute" ? (grant.expiresAt ?? now()) : grant.createdAt + DEFAULT_KEY_TTL_MS;
  if (listing.kind !== "seat" && (update.expiresAt === null || update.expiresAt > ceiling || update.expiresAt <= now())) return false;
  await db.run("UPDATE grants SET max_rpm = ?, max_tokens_per_request = ?, privacy_floor = ?, expires_at = ? WHERE id = ?", [
    update.maxRpm,
    update.maxTokensPerRequest,
    update.privacyFloor,
    update.expiresAt,
    grantId,
  ]);
  await agentLog(
    "enforcer",
    "limits updated",
    `${await aliasOf(actorId)} set ${update.maxRpm} rpm, ${update.maxTokensPerRequest} tokens/request, floor ${update.privacyFloor}.`,
  );
  return true;
}

/** Provider confirms they assigned the seat in the vendor's admin console. The timer starts now. */
export async function activateSeat(grantId: string, providerId: string, seatMinutes: number): Promise<boolean> {
  const ts = now();
  const changes = await db.run(
    "UPDATE grants SET status = 'active', starts_at = ?, expires_at = ? WHERE id = ? AND provider_id = ? AND status = 'pending_assignment'",
    [ts, ts + seatMinutes * 60_000, grantId, providerId],
  );
  if (changes > 0) await agentLog("enforcer", "seat assigned", `${await aliasOf(providerId)} assigned a seat for ${seatMinutes} min.`);
  return changes > 0;
}

/** Reclaim agent: expires grants whose time is up and tells owners to take seats back. */
export async function sweepExpired(): Promise<void> {
  const expired = await db.all<{ id: string; buyer_id: string; provider_id: string | null; service: string; kind: string }>(
    `UPDATE grants g SET status = 'expired' FROM listings l
     WHERE l.id = g.listing_id AND g.status = 'active' AND g.expires_at IS NOT NULL AND g.expires_at < ?
     RETURNING g.id, g.buyer_id, g.provider_id, l.service, l.kind`,
    [now()],
  );
  if (expired.length === 0) return;
  const aliases = await aliasMap(expired.flatMap((g) => [g.buyer_id, g.provider_id]));
  await Promise.all(
    expired.map((g) =>
      agentLog(
        "reclaim",
        "grant expired",
        g.kind === "seat"
          ? `Time is up. ${aliasFrom(aliases, g.provider_id)}: unassign the ${g.service} seat from ${aliasFrom(aliases, g.buyer_id)}.`
          : `Key for ${aliasFrom(aliases, g.buyer_id)} expired.`,
      ),
    ),
  );
}

export interface UsageRecord {
  grantId: string;
  reservationId?: string;
  endpoint: string;
  backend: string;
  tier: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs: number;
  outcome: "ok" | "blocked" | "error";
  reason?: string;
}

/** Writes metering metadata and debits the budget atomically. Never stores content. */
export async function recordUsage(rec: UsageRecord): Promise<void> {
  await tx(async (t) => {
    // Lock in the same order as reserveBudget. Settlement is idempotent.
    await t.get("SELECT id FROM grants WHERE id = ? FOR UPDATE", [rec.grantId]);
    let charged = Math.max(0, Math.ceil(rec.costMicros));
    if (rec.reservationId) {
      const hold = await t.get<{ amount_micros: number }>("DELETE FROM usage_reservations WHERE id = ? AND grant_id = ? RETURNING amount_micros", [rec.reservationId, rec.grantId]);
      if (!hold) return;
      charged = Math.min(charged, hold.amount_micros);
    } else if (charged > 0) {
      throw new Error("Paid usage requires a budget reservation");
    }
    await t.run(
      `INSERT INTO usage_events (id, grant_id, endpoint, backend, tier, model, prompt_tokens, completion_tokens, cost_micros, latency_ms, outcome, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("use"),
        rec.grantId,
        rec.endpoint,
        rec.backend,
        rec.tier,
        rec.model,
        rec.promptTokens,
        rec.completionTokens,
        charged,
        rec.latencyMs,
        rec.outcome,
        rec.reason ?? null,
        now(),
      ],
    );
    if (charged > 0) {
      await t.run(
        `UPDATE grants SET spent_micros = spent_micros + ?,
           status = CASE WHEN status = 'active' AND spent_micros + ? >= budget_micros THEN 'exhausted' ELSE status END
         WHERE id = ?`,
        [charged, charged, rec.grantId],
      );
    }
  });
}

export interface GrantUsageSummary {
  requests: number;
  blocked: number;
  tokens: number;
  costMicros: number;
  byBackend: Array<{ backend: string; requests: number }>;
}

export async function usageSummary(grantId: string): Promise<GrantUsageSummary> {
  const [totals, byBackend] = await Promise.all([
    db.get<{ requests: number; blocked: number | null; tokens: number; cost: number }>(
      `SELECT COUNT(*) AS requests,
              SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
              COALESCE(SUM(cost_micros), 0) AS cost
       FROM usage_events WHERE grant_id = ?`,
      [grantId],
    ),
    db.all<{ backend: string; requests: number }>(
      "SELECT backend, COUNT(*) AS requests FROM usage_events WHERE grant_id = ? AND outcome = 'ok' GROUP BY backend",
      [grantId],
    ),
  ]);
  return {
    requests: totals?.requests ?? 0,
    blocked: totals?.blocked ?? 0,
    tokens: totals?.tokens ?? 0,
    costMicros: totals?.cost ?? 0,
    byBackend,
  };
}
