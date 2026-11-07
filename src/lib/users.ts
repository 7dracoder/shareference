import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { db, now, tx } from "./db";
import { hashPassword, newId, verifyPassword } from "./crypto";
import { env } from "./env";

export const payoutMethodsSchema = z.object({
  zelle: z.string().max(120).optional(),
  zelleName: z.string().max(120).optional(),
  venmo: z.string().max(60).optional(),
  cashapp: z.string().max(60).optional(),
  paypal: z.string().max(120).optional(),
  usdc: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "USDC address must be a 0x… Base address")
    .optional(),
});

export type PayoutMethods = z.infer<typeof payoutMethodsSchema>;

export interface User {
  id: string;
  email: string;
  name: string;
  /** Public pseudonym. Other users only ever see this, never email or name. */
  alias: string;
  payoutMethods: PayoutMethods;
  isAdmin: boolean;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  alias: string;
  password_hash: string;
  payout_methods: string;
}

function parsePayout(raw: string): PayoutMethods {
  try {
    const parsed = payoutMethodsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    alias: row.alias,
    payoutMethods: parsePayout(row.payout_methods),
    isAdmin: Boolean(env.ADMIN_EMAIL) && row.email === env.ADMIN_EMAIL?.toLowerCase(),
  };
}

function randomAlias(): string {
  const words = ["otter", "falcon", "maple", "comet", "harbor", "cobalt", "ember", "lumen"];
  const word = words[crypto.randomInt(words.length)];
  return `${word}-${crypto.randomBytes(2).toString("hex")}`;
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? toUser(row) : null;
}

export async function createUser(email: string, name: string, password: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const exists = await db.get("SELECT 1 FROM users WHERE email = ?", [normalized]);
  if (exists) throw new Error("An account with this email already exists");
  const id = newId("usr");
  await db.run("INSERT INTO users (id, email, name, alias, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    normalized,
    name.trim(),
    randomAlias(),
    hashPassword(password),
    now(),
  ]);
  const user = await getUserById(id);
  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = await db.get<UserRow>("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return toUser(row);
}

export async function setPayoutMethods(userId: string, methods: PayoutMethods): Promise<void> {
  const clean = Object.fromEntries(Object.entries(methods).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  await db.run("UPDATE users SET payout_methods = ? WHERE id = ?", [JSON.stringify(clean), userId]);
}

export async function aliasOf(userId: string | null): Promise<string> {
  if (!userId) return "Shareference";
  const row = await db.get<{ alias: string }>("SELECT alias FROM users WHERE id = ?", [userId]);
  return row?.alias ?? "unknown";
}

/** Batch alias lookup for lists, so pages don't issue one query per row. */
export async function aliasMap(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.all<{ id: string; alias: string }>(`SELECT id, alias FROM users WHERE id IN (${placeholders})`, unique);
  rows.forEach((r) => map.set(r.id, r.alias));
  return map;
}

export function aliasFrom(map: Map<string, string>, id: string | null): string {
  return id ? (map.get(id) ?? "unknown") : "Shareference";
}

/** Link an existing account only using an email verified by Clerk. Never copy passwords. */
export async function syncClerkUser(profile: { id: string; name: string; verifiedEmail?: string }): Promise<User> {
  const email = profile.verifiedEmail?.trim().toLowerCase();
  const id = await tx(async (t) => {
    // Serialize first-login linking across concurrent navigation requests.
    await t.get("SELECT pg_advisory_xact_lock(hashtext(?))", [email || profile.id]);
    let row = await t.get<UserRow>("SELECT * FROM users WHERE clerk_id = ? FOR UPDATE", [profile.id]);
    if (!row && email) row = await t.get<UserRow & { clerk_id: string | null }>("SELECT * FROM users WHERE email = ? AND clerk_id IS NULL FOR UPDATE", [email]);
    if (row) {
      await t.run("UPDATE users SET clerk_id = ?, name = ? WHERE id = ?", [profile.id, profile.name.slice(0, 80), row.id]);
      return row.id;
    }
    const id = newId("usr");
    await t.run("INSERT INTO users (id, clerk_id, email, name, alias, password_hash, created_at) VALUES (?, ?, ?, ?, ?, '', ?)",
      [id, profile.id, email || `${profile.id}@users.clerk.invalid`, profile.name.slice(0, 80), randomAlias(), now()]);
    return id;
  });
  const user = await getUserById(id);
  if (!user) throw new Error("Could not load your profile");
  // An old email or an unverified email must never grant operator privileges.
  return { ...user, isAdmin: Boolean(email && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase()) };
}
