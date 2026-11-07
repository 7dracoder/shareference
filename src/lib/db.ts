import "server-only";
import postgres from "postgres";
import { env } from "./env";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  alias TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  payout_methods TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('pool','api_key','seat')),
  service TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',
  models TEXT NOT NULL DEFAULT '[]',
  price_per_1k_micros BIGINT NOT NULL DEFAULT 0,
  seat_price_cents BIGINT NOT NULL DEFAULT 0,
  seat_minutes INTEGER NOT NULL DEFAULT 0,
  min_purchase_cents BIGINT NOT NULL DEFAULT 500,
  max_rpm INTEGER NOT NULL DEFAULT 60,
  max_tokens_per_request INTEGER NOT NULL DEFAULT 4000,
  upstream_base_url TEXT,
  vault_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','rejected')),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  key_hash TEXT UNIQUE,
  key_prefix TEXT,
  key_ciphertext TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  models TEXT NOT NULL DEFAULT '[]',
  budget_micros BIGINT NOT NULL DEFAULT 0,
  spent_micros BIGINT NOT NULL DEFAULT 0,
  max_rpm INTEGER NOT NULL DEFAULT 60,
  max_tokens_per_request INTEGER NOT NULL DEFAULT 4000,
  privacy_floor TEXT NOT NULL DEFAULT 'private' CHECK (privacy_floor IN ('fast','private','verified')),
  starts_at BIGINT NOT NULL,
  expires_at BIGINT,
  status TEXT NOT NULL CHECK (status IN ('pending_assignment','active','revoked','expired','exhausted')),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_buyer ON grants(buyer_id);
CREATE INDEX IF NOT EXISTS grants_provider ON grants(provider_id);

-- Usage is metadata only. Prompts and outputs are never stored.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES grants(id),
  endpoint TEXT NOT NULL,
  backend TEXT NOT NULL,
  tier TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_grant ON usage_events(grant_id);
CREATE INDEX IF NOT EXISTS usage_time ON usage_events(created_at);

-- Orders. Money never touches Switchboard: buyers pay recipients directly,
-- and each recipient (or the chain) confirms receipt.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  gross_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  provider_cents BIGINT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('zelle','venmo','cashapp','paypal','usdc','demo')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','buyer_marked_sent','completed','canceled')),
  provider_confirmed_at BIGINT,
  fee_confirmed_at BIGINT,
  buyer_marked_at BIGINT,
  payer_wallet TEXT,
  grant_id TEXT REFERENCES grants(id),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_provider ON payments(provider_id, status);
CREATE INDEX IF NOT EXISTS payments_buyer ON payments(buyer_id);

-- Each on-chain transfer can pay for one order only.
CREATE TABLE IF NOT EXISTS used_tx (
  tx_hash TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_time ON agent_events(created_at);

-- Shared rate-limit counters (works across serverless instances).
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
`;

type Param = string | number | null;
type Sql = postgres.Sql<Record<string, never>>;

const toNumber = { from: [20, 1700], to: 20, parse: (v: string) => Number(v), serialize: (v: number) => String(v) };

function connect(): Sql {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return postgres(env.DATABASE_URL, {
    // Neon's pooled endpoint runs PgBouncer in transaction mode.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: { bigint: toNumber },
  }) as unknown as Sql;
}

const g = globalThis as unknown as { __sbSql?: Sql; __sbSchema?: Promise<void> };

function client(): Sql {
  g.__sbSql ??= connect();
  return g.__sbSql;
}

function ready(): Promise<void> {
  g.__sbSchema ??= client()
    .unsafe(SCHEMA)
    .then(() => undefined)
    .catch((error: unknown) => {
      g.__sbSchema = undefined;
      throw error;
    });
  return g.__sbSchema;
}

/** Converts `?` placeholders to Postgres `$n`. Our SQL never uses `?` inside string literals. */
function toPg(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

export interface Db {
  all<T>(text: string, params?: Param[]): Promise<T[]>;
  get<T>(text: string, params?: Param[]): Promise<T | undefined>;
  run(text: string, params?: Param[]): Promise<number>;
}

function wrap(sql: Sql | postgres.TransactionSql<Record<string, never>>): Db {
  return {
    async all<T>(text: string, params: Param[] = []) {
      return (await sql.unsafe(toPg(text), params)) as unknown as T[];
    },
    async get<T>(text: string, params: Param[] = []) {
      const rows = (await sql.unsafe(toPg(text), params)) as unknown as T[];
      return rows[0];
    },
    async run(text: string, params: Param[] = []) {
      const res = await sql.unsafe(toPg(text), params);
      return res.count;
    },
  };
}

export const db: Db = {
  async all<T>(text: string, params?: Param[]) {
    await ready();
    return wrap(client()).all<T>(text, params);
  },
  async get<T>(text: string, params?: Param[]) {
    await ready();
    return wrap(client()).get<T>(text, params);
  },
  async run(text: string, params?: Param[]) {
    await ready();
    return wrap(client()).run(text, params);
  },
};

/** Runs `fn` in a single database transaction. */
export async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  await ready();
  return client().begin((t) => fn(wrap(t))) as Promise<T>;
}

export function now(): number {
  return Date.now();
}

export function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
