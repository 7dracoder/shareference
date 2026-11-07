import "server-only";
import { env } from "../env";
import { openSecret } from "../crypto";
import { getListingCredential, type Listing } from "../listings";
import type { Grant } from "../grants";
import { TIER_INFO, TIER_RANK, TIERS, type Tier } from "../pricing";
import { agentLog } from "./log";
import { darkbloomChat, darkbloomEnabled } from "../integrations/darkbloom";
import { tinfoilChat, tinfoilEnabled } from "../integrations/tinfoil";
import { detectPii, sieChat, sieEnabled } from "../integrations/sie";
import {
  BackendError,
  callOpenAiCompatible,
  lastUserText,
  mockChat,
  type BackendResult,
  type ChatRequest,
} from "../integrations/openai-compat";

export interface RoutedResult extends BackendResult {
  backend: string;
  tier: Tier | "shared";
  pricePer1kMicros: number;
  upgradedForPii: boolean;
}

interface TierBackend {
  enabled: () => boolean;
  call: (req: ChatRequest) => Promise<BackendResult>;
  name: string;
}

const BACKENDS: Record<Tier, TierBackend> = {
  fast: { enabled: sieEnabled, call: sieChat, name: "superlinked-sie" },
  private: { enabled: darkbloomEnabled, call: darkbloomChat, name: "darkbloom" },
  verified: { enabled: tinfoilEnabled, call: tinfoilChat, name: "tinfoil" },
};

export function parseTier(value: string | null): Tier | null {
  return value && (TIERS as readonly string[]).includes(value) ? (value as Tier) : null;
}

/** Shared-account listings: forward to the provider's own upstream with their sealed key. */
async function routeShared(listing: Listing, request: ChatRequest): Promise<RoutedResult> {
  const sealed = await getListingCredential(listing.id);
  if (!sealed || !listing.upstreamBaseUrl) throw new BackendError("Listing has no credential", 503, false);
  const model = request.model ?? listing.models[0];
  if (!model) throw new BackendError("Specify a model", 400, false);
  const result = await callOpenAiCompatible({
    baseUrl: listing.upstreamBaseUrl,
    apiKey: openSecret(sealed),
    model,
    request,
  });
  return { ...result, backend: `shared:${listing.service}`, tier: "shared", pricePer1kMicros: listing.pricePer1kMicros, upgradedForPii: false };
}

/**
 * Router agent for the pool. Picks the cheapest tier that meets the privacy
 * floor, upgrades to 'verified' when personal data is detected, and only ever
 * falls back upward, never to a less private backend.
 */
async function routePool(grant: Grant, request: ChatRequest, requested: Tier | null): Promise<RoutedResult> {
  const floor = grant.privacyFloor;
  let tier: Tier = requested && TIER_RANK[requested] >= TIER_RANK[floor] ? requested : floor;
  let upgradedForPii = false;

  if (tier !== "verified") {
    const scan = await detectPii(lastUserText(request));
    if (scan.found) {
      tier = "verified";
      upgradedForPii = true;
      await agentLog("router", "upgraded to verified", `Personal data detected (${scan.labels.join(", ")}); routed to Tinfoil enclave.`);
    }
  }

  const chain = TIERS.filter((t) => TIER_RANK[t] >= TIER_RANK[tier]);
  let lastError: BackendError | null = null;
  for (const candidate of chain) {
    const backend = BACKENDS[candidate];
    if (!backend.enabled()) continue;
    try {
      const result = await backend.call(request);
      if (candidate !== tier) await agentLog("router", "fell back upward", `${BACKENDS[tier].name} unavailable; served by ${backend.name}.`);
      return { ...result, backend: backend.name, tier: candidate, pricePer1kMicros: TIER_INFO[candidate].pricePer1kMicros, upgradedForPii };
    } catch (error: unknown) {
      lastError = error instanceof BackendError ? error : new BackendError(String(error), 502, true);
      if (!lastError.retryable) throw lastError;
    }
  }

  if (env.DEMO_MODE) {
    const result = mockChat(BACKENDS[tier].name, request);
    // Placeholder replies are never billed.
    return { ...result, backend: `${BACKENDS[tier].name}-demo`, tier, pricePer1kMicros: 0, upgradedForPii };
  }
  throw lastError ?? new BackendError(`No backend configured for tier '${tier}' or above`, 503, false);
}

export function routeChat(grant: Grant, listing: Listing, request: ChatRequest, requested: Tier | null): Promise<RoutedResult> {
  return listing.kind === "api_key" ? routeShared(listing, request) : routePool(grant, request, requested);
}
