import "server-only";
import { hit } from "../rate-limit";
import type { Grant } from "../grants";
import type { Feature } from "../listings";

const WINDOW_MS = 60_000;

export interface Denial {
  status: number;
  code: string;
  message: string;
}

export interface EnforceInput {
  feature: Feature;
  model?: string;
  requestedTokens?: number;
}

/**
 * Enforcer agent: checks every call against the owner's limits.
 * Returns null when allowed, or a denial the API returns as an OpenAI-style error.
 */
export async function enforce(grant: Grant, input: EnforceInput): Promise<Denial | null> {
  if (grant.status === "revoked") return { status: 403, code: "grant_revoked", message: "This key was revoked by its owner." };
  if (grant.status === "exhausted") return { status: 402, code: "budget_exhausted", message: "Budget used up. Buy more credit to continue." };
  if (grant.status === "pending_assignment") return { status: 403, code: "not_active", message: "This grant is not active yet." };
  if (grant.status === "expired" || (grant.expiresAt !== null && grant.expiresAt < Date.now())) {
    return { status: 403, code: "grant_expired", message: "This key has expired." };
  }
  if (grant.startsAt > Date.now()) return { status: 403, code: "not_started", message: "This key is not active yet." };
  if (!grant.features.includes(input.feature)) {
    return { status: 403, code: "feature_not_granted", message: `The owner has not granted '${input.feature}' on this key.` };
  }
  if (input.model && grant.models.length > 0 && !grant.models.includes(input.model)) {
    return { status: 403, code: "model_not_granted", message: `Model '${input.model}' is not allowed. Allowed: ${grant.models.join(", ")}.` };
  }
  if (input.requestedTokens && input.requestedTokens > grant.maxTokensPerRequest) {
    return {
      status: 400,
      code: "max_tokens_exceeded",
      message: `max_tokens ${input.requestedTokens} exceeds the owner's limit of ${grant.maxTokensPerRequest}.`,
    };
  }
  if (grant.spentMicros >= grant.budgetMicros) {
    return { status: 402, code: "budget_exhausted", message: "Budget used up. Buy more credit to continue." };
  }
  if (!(await hit(`grant:${grant.id}`, grant.maxRpm, WINDOW_MS))) {
    return { status: 429, code: "rate_limited", message: `Rate limit of ${grant.maxRpm} requests/minute reached.` };
  }
  return null;
}
