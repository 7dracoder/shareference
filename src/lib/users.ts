import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { db, now } from "./db";
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

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function createUser(email: string, name: string, password: string): User {
  const normalized = email.trim().toLowerCase();
  const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalized);
  if (exists) throw new Error("An account with this email already exists");
  const id = newId("usr");
  db.prepare(
    `INSERT INTO users (id, email, name, alias, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, normalized, name.trim(), randomAlias(), hashPassword(password), now());
  const user = getUserById(id);
  if (!user) throw new Error("Failed to create user");
  return user;
}

export function authenticate(email: string, password: string): User | null {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return toUser(row);
}

export function setPayoutMethods(userId: string, methods: PayoutMethods): void {
  const clean = Object.fromEntries(Object.entries(methods).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  db.prepare("UPDATE users SET payout_methods = ? WHERE id = ?").run(JSON.stringify(clean), userId);
}

export function hasPayoutMethod(methods: PayoutMethods): boolean {
  return Boolean(methods.zelle || methods.venmo || methods.cashapp || methods.paypal || methods.usdc);
}

export function aliasOf(userId: string | null): string {
  if (!userId) return "Switchboard";
  const row = db.prepare("SELECT alias FROM users WHERE id = ?").get(userId) as
    | { alias: string }
    | undefined;
  return row?.alias ?? "unknown";
}
