import "server-only";
import { grantByKey, recordUsage, type Grant } from "./grants";
import { getListing, type Feature, type Listing } from "./listings";
import { enforce } from "./agents/enforcer";
import { agentLog } from "./agents/log";
import { aliasOf } from "./users";

export function openAiError(status: number, code: string, message: string): Response {
  return Response.json({ error: { message, type: "shareference_error", code } }, { status });
}

export interface Authorized {
  grant: Grant;
  listing: Listing;
}

/** Resolves the caller's sub-key to a grant. Returns an error Response on failure. */
export async function authorize(req: Request): Promise<Authorized | Response> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(shr_[A-Za-z0-9_-]{20,})$/.exec(header.trim());
  if (!match) return openAiError(401, "invalid_api_key", "Missing or malformed Shareference key (Authorization: Bearer shr_...).");
  const grant = await grantByKey(match[1]);
  if (!grant) return openAiError(401, "invalid_api_key", "Unknown key.");
  const listing = await getListing(grant.listingId);
  if (!listing) return openAiError(410, "listing_gone", "The listing behind this key no longer exists.");
  return { grant, listing };
}

/** Runs the Enforcer agent. Blocks are metered (as zero-cost events) so owners see them. */
export async function checkOrBlock(
  auth: Authorized,
  endpoint: string,
  input: { feature: Feature; model?: string; requestedTokens?: number },
): Promise<Response | null> {
  const denial = await enforce(auth.grant, input);
  if (!denial) return null;
  await recordUsage({
    grantId: auth.grant.id,
    endpoint,
    backend: "none",
    tier: "none",
    model: input.model ?? null,
    promptTokens: 0,
    completionTokens: 0,
    costMicros: 0,
    latencyMs: 0,
    outcome: "blocked",
    reason: denial.code,
  });
  if (denial.code !== "rate_limited") {
    await agentLog("enforcer", "blocked request", `${await aliasOf(auth.grant.buyerId)}: ${denial.code} on ${endpoint}.`);
  }
  return openAiError(denial.status, denial.code, denial.message);
}

export async function readJson(req: Request, maxBytes = 1_000_000): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new Error("Request body too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("Request body too large");
  return JSON.parse(text);
}
