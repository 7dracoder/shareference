import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, env } from "./env";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SCRYPT_KEYLEN = 64;

/**
 * Returns a 32-byte secret from the env var, or (development only) a random
 * one persisted in DATA_DIR so sessions survive restarts.
 */
function loadSecret(value: string | undefined, file: string): Buffer {
  if (value) {
    const buf = Buffer.from(value, "base64");
    if (buf.length < KEY_BYTES) throw new Error(`${file} must be at least 32 bytes (base64)`);
    return buf.subarray(0, KEY_BYTES);
  }
  if (env.NODE_ENV === "production") throw new Error(`${file} is required in production`);
  const p = path.join(/*turbopackIgnore: true*/ dataDir, `.${file}`);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, crypto.randomBytes(KEY_BYTES).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(p, "utf8"), "base64");
}

// Loaded on first use so `next build` never needs runtime secrets.
let sessionKeyCache: Buffer | null = null;
let vaultKeyCache: Buffer | null = null;

function sessionKey(): Buffer {
  sessionKeyCache ??= loadSecret(env.SESSION_SECRET, "session-secret");
  return sessionKeyCache;
}

function vaultKey(): Buffer {
  vaultKeyCache ??= loadSecret(env.VAULT_KEY, "vault-key");
  return vaultKeyCache;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

/** Encrypts a credential with AES-256-GCM. Output: base64url(iv|tag|ciphertext). */
export function sealSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openSecret(sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = raw.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", vaultKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface IssuedKey {
  key: string;
  hash: string;
  prefix: string;
}

export function issueApiKey(): IssuedKey {
  const key = `shr_${crypto.randomBytes(24).toString("base64url")}`;
  return { key, hash: hashToken(key), prefix: key.slice(0, 10) };
}

export function sign(value: string): string {
  return crypto.createHmac("sha256", sessionKey()).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64url"), SCRYPT_KEYLEN);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
