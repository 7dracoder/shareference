import "server-only";
import { env } from "./env";

/** 1 USD = 1,000,000 micros. All metering is done in integer micros. */
export const MICROS_PER_CENT = 10_000;

export type Tier = "fast" | "private" | "verified";
export const TIERS: readonly Tier[] = ["fast", "private", "verified"] as const;

/** Ordering used for privacy floors: a request may move up, never down. */
export const TIER_RANK: Record<Tier, number> = { fast: 0, private: 1, verified: 2 };

export interface TierInfo {
  tier: Tier;
  label: string;
  backend: string;
  guarantee: string;
  /** Pool price charged to buyers, per 1K tokens. */
  pricePer1kMicros: number;
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  fast: {
    tier: "fast",
    label: "Fast",
    backend: "Superlinked SIE",
    guarantee: "Small task-specific open models. Cheapest.",
    pricePer1kMicros: 60,
  },
  private: {
    tier: "private",
    label: "Private",
    backend: "Darkbloom",
    guarantee: "Darkbloom inference over HTTPS. See the privacy page for the trust model.",
    pricePer1kMicros: 400,
  },
  verified: {
    tier: "verified",
    label: "Verified",
    backend: "Tinfoil",
    guarantee: "Inference runs in an attested enclave verified by the Tinfoil SDK.",
    pricePer1kMicros: 1200,
  },
};

export interface FeeSplit {
  grossCents: number;
  feeCents: number;
  providerCents: number;
}

/** Platform takes PLATFORM_FEE_BPS (default 10%); the provider gets the rest. */
export function splitPayment(grossCents: number, platformIsSeller: boolean): FeeSplit {
  if (platformIsSeller) return { grossCents, feeCents: grossCents, providerCents: 0 };
  const feeCents = Math.round((grossCents * env.PLATFORM_FEE_BPS) / 10_000);
  return { grossCents, feeCents, providerCents: grossCents - feeCents };
}

export function costMicros(totalTokens: number, pricePer1kMicros: number): number {
  return Math.ceil((totalTokens * pricePer1kMicros) / 1000);
}

export function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(micros < 10_000 && micros > 0 ? 4 : 2)}`;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function feePercent(): string {
  return `${env.PLATFORM_FEE_BPS / 100}%`;
}
