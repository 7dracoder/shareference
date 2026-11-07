import "server-only";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: optional,
  VAULT_KEY: optional,
  DATA_DIR: optional,
  DATABASE_URL: optional,
  ADMIN_EMAIL: optional,
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Platform payout handles: where the 10% fee (and pool sales) go. Direct to your bank.
  PLATFORM_ZELLE: optional,
  PLATFORM_ZELLE_NAME: optional,
  /** Optional override for the Zelle QR image URL. Defaults to /zelle-qr.png when unset. */
  PLATFORM_ZELLE_QR_URL: optional,
  PLATFORM_VENMO: optional,
  PLATFORM_CASHAPP: optional,
  PLATFORM_PAYPAL: optional,
  PLATFORM_USDC_ADDRESS: optional,
  USDC_NETWORK: z.enum(["base", "base-sepolia"]).default("base-sepolia"),
  BASE_RPC_URL: optional,

  DARKBLOOM_BASE_URL: optional,
  DARKBLOOM_API_KEY: optional,
  DARKBLOOM_MODEL: optional,

  OPENROUTER_API_KEY: optional,
  OPENROUTER_MODEL: z.string().default("deepseek/deepseek-v4.1-flash-1017"),

  TINFOIL_API_KEY: optional,
  TINFOIL_MODEL: z.string().default("llama3-3-70b"),

  SIE_BASE_URL: optional,
  SIE_API_KEY: optional,
  SIE_EMBED_MODEL: z.string().default("BAAI/bge-m3"),
  SIE_RERANK_MODEL: z.string().default("Qwen/Qwen3-Reranker-0.6B"),
  SIE_PII_MODEL: z.string().default("urchade/gliner_multi-v2.1"),
  SIE_CHAT_MODEL: z.string().default("Qwen/Qwen3.5-4B"),

  COGNEE_BASE_URL: optional,
  COGNEE_API_KEY: optional,
  COGNEE_TENANT_ID: optional,
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const parsed = schema.safeParse({
    ...process.env,
    APP_URL: process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : undefined),
  });
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  const env = parsed.data;
  // `next build` runs with NODE_ENV=production; runtime checks apply only when serving.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (!isBuild && env.NODE_ENV === "production" && !env.VAULT_KEY) {
    throw new Error("VAULT_KEY is required in production");
  }
  if (!isBuild && env.NODE_ENV === "production" && env.DEMO_MODE) {
    throw new Error("DEMO_MODE must be disabled in production");
  }
  return env;
}

export const env: Env = load();

export const dataDir: string = env.DATA_DIR ?? path.join(os.homedir(), ".shareference");

export interface IntegrationStatus {
  bankPayouts: boolean;
  usdc: boolean;
  openrouter: boolean;
  darkbloom: boolean;
  tinfoil: boolean;
  sie: boolean;
  cognee: boolean;
}

export function integrationStatus(): IntegrationStatus {
  return {
    bankPayouts: Boolean(env.PLATFORM_ZELLE || env.PLATFORM_VENMO || env.PLATFORM_CASHAPP || env.PLATFORM_PAYPAL),
    usdc: Boolean(env.PLATFORM_USDC_ADDRESS),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
    darkbloom: Boolean(env.DARKBLOOM_BASE_URL && env.DARKBLOOM_API_KEY),
    tinfoil: Boolean(env.TINFOIL_API_KEY),
    sie: Boolean(env.SIE_BASE_URL),
    cognee: Boolean(env.COGNEE_BASE_URL && env.COGNEE_API_KEY),
  };
}
