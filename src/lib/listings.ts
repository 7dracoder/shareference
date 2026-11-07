import "server-only";
import { db, now, parseJsonArray } from "./db";
import { newId, sealSecret } from "./crypto";
import { aliasOf } from "./users";
import { checkPolicy } from "./policy";
import { agentLog } from "./agents/log";

export type ListingKind = "pool" | "api_key" | "seat";
export type ListingStatus = "active" | "paused" | "rejected";
export type Feature = "chat" | "embeddings" | "rerank";

export const POOL_LISTING_ID = "lst_pool";

export interface Listing {
  id: string;
  providerId: string | null;
  providerAlias: string;
  kind: ListingKind;
  service: string;
  title: string;
  description: string;
  features: string[];
  models: string[];
  pricePer1kMicros: number;
  seatPriceCents: number;
  seatMinutes: number;
  minPurchaseCents: number;
  maxRpm: number;
  maxTokensPerRequest: number;
  upstreamBaseUrl: string | null;
  hasCredential: boolean;
  status: ListingStatus;
  createdAt: number;
}

interface ListingRow {
  id: string;
  provider_id: string | null;
  kind: ListingKind;
  service: string;
  title: string;
  description: string;
  features: string;
  models: string;
  price_per_1k_micros: number;
  seat_price_cents: number;
  seat_minutes: number;
  min_purchase_cents: number;
  max_rpm: number;
  max_tokens_per_request: number;
  upstream_base_url: string | null;
  vault_ciphertext: string | null;
  status: ListingStatus;
  created_at: number;
}

function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerAlias: aliasOf(row.provider_id),
    kind: row.kind,
    service: row.service,
    title: row.title,
    description: row.description,
    features: parseJsonArray(row.features),
    models: parseJsonArray(row.models),
    pricePer1kMicros: row.price_per_1k_micros,
    seatPriceCents: row.seat_price_cents,
    seatMinutes: row.seat_minutes,
    minPurchaseCents: row.min_purchase_cents,
    maxRpm: row.max_rpm,
    maxTokensPerRequest: row.max_tokens_per_request,
    upstreamBaseUrl: row.upstream_base_url,
    hasCredential: Boolean(row.vault_ciphertext),
    status: row.status,
    createdAt: row.created_at,
  };
}

/** The platform-owned inference pool (Idea 1). Seller is Switchboard itself. */
export function ensurePoolListing(): void {
  db.prepare(
    `INSERT OR IGNORE INTO listings
      (id, provider_id, kind, service, title, description, features, models, min_purchase_cents, max_rpm, max_tokens_per_request, status, created_at)
     VALUES (?, NULL, 'pool', 'switchboard-pool', ?, ?, ?, '[]', 500, 120, 8000, 'active', ?)`,
  ).run(
    POOL_LISTING_ID,
    "Switchboard private inference pool",
    "One OpenAI-compatible key. Requests are routed to Superlinked SIE (fast), Darkbloom (private) or Tinfoil (verified) by cost and privacy. Requests containing personal data are upgraded to the verified tier automatically.",
    JSON.stringify(["chat", "embeddings", "rerank"]),
    now(),
  );
}

export function getListing(id: string): Listing | null {
  ensurePoolListing();
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as ListingRow | undefined;
  return row ? toListing(row) : null;
}

/** Server-only: returns the sealed provider credential for the proxy. */
export function getListingCredential(id: string): string | null {
  const row = db.prepare("SELECT vault_ciphertext FROM listings WHERE id = ?").get(id) as
    | { vault_ciphertext: string | null }
    | undefined;
  return row?.vault_ciphertext ?? null;
}

export function activeListings(): Listing[] {
  ensurePoolListing();
  const rows = db
    .prepare("SELECT * FROM listings WHERE status = 'active' ORDER BY kind = 'pool' DESC, created_at DESC")
    .all() as ListingRow[];
  return rows.map(toListing);
}

export function listingsByProvider(providerId: string): Listing[] {
  const rows = db
    .prepare("SELECT * FROM listings WHERE provider_id = ? ORDER BY created_at DESC")
    .all(providerId) as ListingRow[];
  return rows.map(toListing);
}

export interface NewListingInput {
  kind: "api_key" | "seat";
  service: string;
  title: string;
  description: string;
  features: string[];
  models: string[];
  pricePer1kMicros: number;
  seatPriceCents: number;
  seatMinutes: number;
  minPurchaseCents: number;
  maxRpm: number;
  maxTokensPerRequest: number;
  upstreamBaseUrl: string | null;
  credential: string | null;
}

export interface CreateListingResult {
  ok: boolean;
  message: string;
  listingId?: string;
}

/** Policy Guard agent checks the service's sharing rules before anything is stored. */
export function createListing(providerId: string, input: NewListingInput): CreateListingResult {
  const decision = checkPolicy(input.service, input.kind);
  if (!decision.allowed) {
    agentLog("policy-guard", "rejected listing", `${aliasOf(providerId)} tried to list ${input.service}: ${decision.reason}`);
    return { ok: false, message: decision.reason };
  }
  if (input.kind === "api_key" && (!input.credential || !input.upstreamBaseUrl)) {
    return { ok: false, message: "API listings need a base URL and an API key." };
  }
  const id = newId("lst");
  db.prepare(
    `INSERT INTO listings
      (id, provider_id, kind, service, title, description, features, models, price_per_1k_micros,
       seat_price_cents, seat_minutes, min_purchase_cents, max_rpm, max_tokens_per_request,
       upstream_base_url, vault_ciphertext, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    id,
    providerId,
    input.kind,
    input.service,
    input.title,
    input.description,
    JSON.stringify(input.features),
    JSON.stringify(input.models),
    input.pricePer1kMicros,
    input.seatPriceCents,
    input.seatMinutes,
    input.minPurchaseCents,
    input.maxRpm,
    input.maxTokensPerRequest,
    input.upstreamBaseUrl,
    input.credential ? sealSecret(input.credential) : null,
    now(),
  );
  agentLog("policy-guard", "approved listing", `${aliasOf(providerId)} listed ${input.service} (${input.kind}). ${decision.reason}`);
  return { ok: true, message: "Listing published.", listingId: id };
}

export function setListingStatus(listingId: string, providerId: string, status: "active" | "paused"): boolean {
  const res = db
    .prepare("UPDATE listings SET status = ? WHERE id = ? AND provider_id = ? AND status != 'rejected'")
    .run(status, listingId, providerId);
  return res.changes > 0;
}
