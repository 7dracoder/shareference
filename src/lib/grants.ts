import "server-only";
import { db, now, parseJsonArray } from "./db";
import { hashToken, issueApiKey, newId, openSecret, sealSecret } from "./crypto";
import { MICROS_PER_CENT, type Tier } from "./pricing";
import type { Listing } from "./listings";
import { aliasOf } from "./users";
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
}

interface GrantRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  provider_id: string | null;
  key_prefix: string | null;
  key_ciphertext: string | null;
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
}

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
  };
}

const DEFAULT_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Creates the access grant a buyer receives after paying. */
export function createGrantFromPurchase(listing: Listing, buyerId: string, grossCents: number): Grant {
  const id = newId("gr");
  const t = now();
  const isSeat = listing.kind === "seat";
  const key = isSeat ? null : issueApiKey();
  db.prepare(
    `INSERT INTO grants
      (id, listing_id, buyer_id, provider_id, key_hash, key_prefix, key_ciphertext, features, models,
       budget_micros, spent_micros, max_rpm, max_tokens_per_request, privacy_floor, starts_at, expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'private', ?, ?, ?, ?)`,
  ).run(
    id,
    listing.id,
    buyerId,
    listing.providerId,
    key?.hash ?? null,
    key?.prefix ?? null,
    key ? sealSecret(key.key) : null,
    JSON.stringify(listing.features),
    JSON.stringify(listing.models),
    isSeat ? 0 : grossCents * MICROS_PER_CENT,
    listing.maxRpm,
    listing.maxTokensPerRequest,
    t,
    isSeat ? null : t + DEFAULT_KEY_TTL_MS,
    isSeat ? "pending_assignment" : "active",
    t,
  );
  if (isSeat) {
    agentLog(
      "enforcer",
      "seat requested",
      `${aliasOf(buyerId)} bought ${listing.seatMinutes} min of ${listing.service}. Waiting for ${aliasOf(listing.providerId)} to assign the seat.`,
    );
  }
  const grant = getGrant(id);
  if (!grant) throw new Error("Failed to create grant");
  return grant;
}

export function getGrant(id: string): Grant | null {
  const row = db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as GrantRow | undefined;
  return row ? toGrant(row) : null;
}

export function grantByKey(apiKey: string): Grant | null {
  const row = db.prepare("SELECT * FROM grants WHERE key_hash = ?").get(hashToken(apiKey)) as GrantRow | undefined;
  return row ? toGrant(row) : null;
}

/** Only the buyer who owns the grant may reveal its key. */
export function revealKey(grantId: string, buyerId: string): string | null {
  const row = db
    .prepare("SELECT key_ciphertext FROM grants WHERE id = ? AND buyer_id = ?")
    .get(grantId, buyerId) as { key_ciphertext: string | null } | undefined;
  return row?.key_ciphertext ? openSecret(row.key_ciphertext) : null;
}

export function grantsForBuyer(buyerId: string): Grant[] {
  sweepExpired();
  return (db.prepare("SELECT * FROM grants WHERE buyer_id = ? ORDER BY created_at DESC").all(buyerId) as GrantRow[]).map(toGrant);
}

export function grantsForProvider(providerId: string): Grant[] {
  sweepExpired();
  return (db.prepare("SELECT * FROM grants WHERE provider_id = ? ORDER BY created_at DESC").all(providerId) as GrantRow[]).map(
    toGrant,
  );
}

function isParty(grant: Grant, userId: string): boolean {
  return grant.buyerId === userId || grant.providerId === userId;
}

/** Kill switch. Either the owner (provider) or the buyer can end a grant. */
export function revokeGrant(grantId: string, actorId: string): boolean {
  const grant = getGrant(grantId);
  if (!grant || !isParty(grant, actorId) || grant.status === "revoked") return false;
  db.prepare("UPDATE grants SET status = 'revoked' WHERE id = ?").run(grantId);
  agentLog("enforcer", "grant revoked", `${aliasOf(actorId)} revoked grant ${grantId.slice(0, 10)}.`);
  return true;
}

export interface LimitUpdate {
  maxRpm: number;
  maxTokensPerRequest: number;
  privacyFloor: Tier;
  expiresAt: number | null;
}

/** Only the owner (provider) sets limits. Pool grants are owned by the buyer. */
export function updateLimits(grantId: string, actorId: string, update: LimitUpdate): boolean {
  const grant = getGrant(grantId);
  if (!grant) return false;
  const isOwner = grant.providerId ? grant.providerId === actorId : grant.buyerId === actorId;
  if (!isOwner) return false;
  db.prepare(
    "UPDATE grants SET max_rpm = ?, max_tokens_per_request = ?, privacy_floor = ?, expires_at = ? WHERE id = ?",
  ).run(update.maxRpm, update.maxTokensPerRequest, update.privacyFloor, update.expiresAt, grantId);
  agentLog("enforcer", "limits updated", `${aliasOf(actorId)} set ${update.maxRpm} rpm, ${update.maxTokensPerRequest} tokens/request, floor ${update.privacyFloor}.`);
  return true;
}

/** Provider confirms they assigned the seat in the vendor's admin console. The timer starts now. */
export function activateSeat(grantId: string, providerId: string, seatMinutes: number): boolean {
  const t = now();
  const res = db
    .prepare(
      "UPDATE grants SET status = 'active', starts_at = ?, expires_at = ? WHERE id = ? AND provider_id = ? AND status = 'pending_assignment'",
    )
    .run(t, t + seatMinutes * 60_000, grantId, providerId);
  if (res.changes > 0) agentLog("enforcer", "seat assigned", `${aliasOf(providerId)} assigned a seat for ${seatMinutes} min.`);
  return res.changes > 0;
}

/** Reclaim agent: expires grants whose time is up and tells owners to take seats back. */
export function sweepExpired(): void {
  const t = now();
  const expiring = db
    .prepare("SELECT g.*, l.service AS service, l.kind AS kind FROM grants g JOIN listings l ON l.id = g.listing_id WHERE g.status = 'active' AND g.expires_at IS NOT NULL AND g.expires_at < ?")
    .all(t) as Array<GrantRow & { service: string; kind: string }>;
  if (expiring.length === 0) return;
  const mark = db.prepare("UPDATE grants SET status = 'expired' WHERE id = ?");
  db.transaction(() => expiring.forEach((g) => mark.run(g.id)))();
  expiring.forEach((g) => {
    const action = g.kind === "seat" ? `Time is up. ${aliasOf(g.provider_id)}: unassign the ${g.service} seat from ${aliasOf(g.buyer_id)}.` : `Key for ${aliasOf(g.buyer_id)} expired.`;
    agentLog("reclaim", "grant expired", action);
  });
}

export interface UsageRecord {
  grantId: string;
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
export function recordUsage(rec: UsageRecord): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO usage_events (id, grant_id, endpoint, backend, tier, model, prompt_tokens, completion_tokens, cost_micros, latency_ms, outcome, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("use"),
      rec.grantId,
      rec.endpoint,
      rec.backend,
      rec.tier,
      rec.model,
      rec.promptTokens,
      rec.completionTokens,
      rec.costMicros,
      rec.latencyMs,
      rec.outcome,
      rec.reason ?? null,
      now(),
    );
    if (rec.costMicros > 0) {
      db.prepare(
        `UPDATE grants SET spent_micros = spent_micros + ?,
           status = CASE WHEN spent_micros + ? >= budget_micros THEN 'exhausted' ELSE status END
         WHERE id = ?`,
      ).run(rec.costMicros, rec.costMicros, rec.grantId);
    }
  })();
}

export interface GrantUsageSummary {
  requests: number;
  blocked: number;
  tokens: number;
  costMicros: number;
  byBackend: Array<{ backend: string; requests: number }>;
}

export function usageSummary(grantId: string): GrantUsageSummary {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS requests,
              SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked,
              COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
              COALESCE(SUM(cost_micros), 0) AS cost
       FROM usage_events WHERE grant_id = ?`,
    )
    .get(grantId) as { requests: number; blocked: number | null; tokens: number; cost: number };
  const byBackend = db
    .prepare("SELECT backend, COUNT(*) AS requests FROM usage_events WHERE grant_id = ? AND outcome = 'ok' GROUP BY backend")
    .all(grantId) as Array<{ backend: string; requests: number }>;
  return {
    requests: totals.requests,
    blocked: totals.blocked ?? 0,
    tokens: totals.tokens,
    costMicros: totals.cost,
    byBackend,
  };
}
