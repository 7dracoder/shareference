import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "./env";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  alias TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- JSON: { zelle, zelleName, venmo, cashapp, paypal, usdc }. Shown to buyers only during checkout.
  payout_methods TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
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
  price_per_1k_micros INTEGER NOT NULL DEFAULT 0,
  seat_price_cents INTEGER NOT NULL DEFAULT 0,
  seat_minutes INTEGER NOT NULL DEFAULT 0,
  min_purchase_cents INTEGER NOT NULL DEFAULT 500,
  max_rpm INTEGER NOT NULL DEFAULT 60,
  max_tokens_per_request INTEGER NOT NULL DEFAULT 4000,
  upstream_base_url TEXT,
  vault_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','rejected')),
  created_at INTEGER NOT NULL
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
  budget_micros INTEGER NOT NULL DEFAULT 0,
  spent_micros INTEGER NOT NULL DEFAULT 0,
  max_rpm INTEGER NOT NULL DEFAULT 60,
  max_tokens_per_request INTEGER NOT NULL DEFAULT 4000,
  privacy_floor TEXT NOT NULL DEFAULT 'private' CHECK (privacy_floor IN ('fast','private','verified')),
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending_assignment','active','revoked','expired','exhausted')),
  created_at INTEGER NOT NULL
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
  cost_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_grant ON usage_events(grant_id);

-- Orders. Money never touches Switchboard: buyers pay recipients directly,
-- and each recipient (or the chain) confirms receipt.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  provider_id TEXT REFERENCES users(id),
  gross_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  provider_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('zelle','venmo','cashapp','paypal','usdc','demo')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','buyer_marked_sent','completed','canceled')),
  provider_confirmed_at INTEGER,
  fee_confirmed_at INTEGER,
  buyer_marked_at INTEGER,
  payer_wallet TEXT,
  grant_id TEXT REFERENCES grants(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_provider ON payments(provider_id, status);
CREATE INDEX IF NOT EXISTS payments_buyer ON payments(buyer_id);

-- Each on-chain transfer can pay for one order only.
CREATE TABLE IF NOT EXISTS used_tx (
  tx_hash TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_time ON agent_events(created_at);
`;

function open(): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(path.join(dataDir, "switchboard.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// Reuse one connection across hot reloads in development.
const globalForDb = globalThis as unknown as { __switchboardDb?: Database.Database };

export const db: Database.Database = globalForDb.__switchboardDb ?? open();
globalForDb.__switchboardDb = db;

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
