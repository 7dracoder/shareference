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
  provider_alias: string | null;
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
  has_credential: boolean;
  status: ListingStatus;
  created_at: number;
}

// Never selects vault_ciphertext; credentials are read only by getListingCredential.
const SELECT = `
  SELECT l.id, l.provider_id, u.alias AS provider_alias, l.kind, l.service, l.title, l.description, l.features, l.models,
         l.price_per_1k_micros, l.seat_price_cents, l.seat_minutes, l.min_purchase_cents, l.max_rpm, l.max_tokens_per_request,
         l.upstream_base_url, (l.vault_ciphertext IS NOT NULL) AS has_credential, l.status, l.created_at
  FROM listings l LEFT JOIN users u ON u.id = l.provider_id`;

function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerAlias: row.provider_id ? (row.provider_alias ?? "unknown") : "Switchboard",
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
    hasCredential: row.has_credential,
    status: row.status,
    createdAt: row.created_at,
  };
}

let poolEnsured = false;

/** The platform-owned inference pool. Seller is Switchboard itself. */
async function ensurePoolListing(): Promise<void> {
  if (poolEnsured) return;
  await db.run(
    `INSERT INTO listings
      (id, provider_id, kind, service, title, description, features, models, min_purchase_cents, max_rpm, max_tokens_per_request, status, created_at)
     VALUES (?, NULL, 'pool', 'switchboard-pool', ?, ?, ?, '[]', 500, 120, 8000, 'active', ?)
     ON CONFLICT (id) DO NOTHING`,
    [
      POOL_LISTING_ID,
      "Switchboard private inference pool",
      "One OpenAI-compatible key. Requests are routed to Superlinked SIE (fast), Darkbloom (private) or Tinfoil (verified) by cost and privacy. Requests containing personal data are upgraded to the verified tier automatically.",
      JSON.stringify(["chat", "embeddings", "rerank"]),
      now(),
    ],
  );
  poolEnsured = true;
}

export async function getListing(id: string): Promise<Listing | null> {
  await ensurePoolListing();
  const row = await db.get<ListingRow>(`${SELECT} WHERE l.id = ?`, [id]);
  return row ? toListing(row) : null;
}

/** Server-only: returns the sealed provider credential for the proxy. */
export async function getListingCredential(id: string): Promise<string | null> {
  const row = await db.get<{ vault_ciphertext: string | null }>("SELECT vault_ciphertext FROM listings WHERE id = ?", [id]);
  return row?.vault_ciphertext ?? null;
}

export async function activeListings(): Promise<Listing[]> {
  await ensurePoolListing();
  const rows = await db.all<ListingRow>(`${SELECT} WHERE l.status = 'active' ORDER BY (l.kind = 'pool') DESC, l.created_at DESC`);
  return rows.map(toListing);
}

export async function listingsByProvider(providerId: string): Promise<Listing[]> {
  const rows = await db.all<ListingRow>(`${SELECT} WHERE l.provider_id = ? ORDER BY l.created_at DESC`, [providerId]);
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
export async function createListing(providerId: string, input: NewListingInput): Promise<CreateListingResult> {
  const alias = await aliasOf(providerId);
  const decision = checkPolicy(input.service, input.kind);
  if (!decision.allowed) {
    await agentLog("policy-guard", "rejected listing", `${alias} tried to list ${input.service}: ${decision.reason}`);
    return { ok: false, message: decision.reason };
  }
  if (input.kind === "api_key" && (!input.credential || !input.upstreamBaseUrl)) {
    return { ok: false, message: "API listings need a base URL and an API key." };
  }
  const id = newId("lst");
  await db.run(
    `INSERT INTO listings
      (id, provider_id, kind, service, title, description, features, models, price_per_1k_micros,
       seat_price_cents, seat_minutes, min_purchase_cents, max_rpm, max_tokens_per_request,
       upstream_base_url, vault_ciphertext, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
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
    ],
  );
  await agentLog("policy-guard", "approved listing", `${alias} listed ${input.service} (${input.kind}). ${decision.reason}`);
  return { ok: true, message: "Listing published.", listingId: id };
}

export async function setListingStatus(listingId: string, providerId: string, status: "active" | "paused"): Promise<boolean> {
  const changes = await db.run("UPDATE listings SET status = ? WHERE id = ? AND provider_id = ? AND status != 'rejected'", [
    status,
    listingId,
    providerId,
  ]);
  return changes > 0;
}
