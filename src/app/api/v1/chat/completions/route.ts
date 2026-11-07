import { after } from "next/server";
import { authorize, checkOrBlock, openAiError, readJson } from "@/lib/api";
import { parseTier, routeChat } from "@/lib/agents/router";
import { BackendError, chatRequestSchema } from "@/lib/integrations/openai-compat";
import { reserveBudget } from "@/lib/billing";
import { recordUsage } from "@/lib/grants";
import { costMicros, TIER_INFO } from "@/lib/pricing";
import { logger } from "@/lib/logger";

const ENDPOINT = "chat.completions";
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return openAiError(400, "invalid_json", "Body must be valid JSON under 1 MB.");
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return openAiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");
  const request = parsed.data;

  const blocked = await checkOrBlock(auth, ENDPOINT, {
    feature: "chat",
    model: auth.listing.kind === "api_key" ? request.model : undefined,
    requestedTokens: request.max_tokens ?? request.max_completion_tokens,
  });
  if (blocked) return blocked;

  // Cap generation at the owner's per-request limit even if the client didn't ask for one.
  const { max_completion_tokens: completionLimit, ...rest } = request;
  const capped = { ...rest, max_tokens: Math.min(request.max_tokens ?? completionLimit ?? auth.grant.maxTokensPerRequest, auth.grant.maxTokensPerRequest) };
  const maxPrice = auth.listing.kind === "pool" ? TIER_INFO.verified.pricePer1kMicros : auth.listing.pricePer1kMicros;
  // UTF-8 bytes conservatively bound text token counts, including message framing.
  const maxTokens = new TextEncoder().encode(JSON.stringify(capped)).length + capped.max_tokens + request.messages.length * 32;
  const reservationId = await reserveBudget(auth.grant.id, costMicros(maxTokens, maxPrice));
  if (!reservationId) return openAiError(402, "insufficient_credit", "Not enough available credit for this request. Reduce max_tokens or wait for current requests to finish.");
  const started = Date.now();
  try {
    // Pool callers pick a tier with the x-shareference-tier header or model "shareference-<tier>".
    const tierHint =
      parseTier(req.headers.get("x-shareference-tier")) ?? parseTier(request.model?.replace(/^shareference-/, "") ?? null);
    const routed = await routeChat(auth.grant, auth.listing, capped, tierHint);

    // Meter once the (possibly streamed) response has fully finished.
    const settle = async () => {
      try {
        const usage = await routed.usage;
        await recordUsage({
          grantId: auth.grant.id,
          reservationId,
          endpoint: ENDPOINT,
          backend: routed.backend,
          tier: routed.tier,
          model: routed.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costMicros: costMicros(usage.promptTokens + usage.completionTokens, routed.pricePer1kMicros),
          latencyMs: Date.now() - started,
          outcome: "ok",
          reason: routed.upgradedForPii ? "pii_upgrade" : undefined,
        });
      } catch (error: unknown) {
        logger.error("usage metering failed", { error: String(error), grant: auth.grant.id });
        if (!request.stream) throw error;
      }
    };
    if (request.stream) after(settle);
    else await settle();

    const headers = new Headers(routed.response.headers);
    headers.set("x-shareference-backend", routed.backend);
    headers.set("x-shareference-tier", routed.tier);
    return new Response(routed.response.body, { status: routed.response.status, headers });
  } catch (error: unknown) {
    const status = error instanceof BackendError ? error.status : 502;
    logger.warn("chat routing failed", { grant: auth.grant.id, status, error: String(error) });
    await recordUsage({
      grantId: auth.grant.id,
      reservationId,
      endpoint: ENDPOINT,
      backend: "none",
      tier: "none",
      model: null,
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      latencyMs: Date.now() - started,
      outcome: "error",
      reason: `upstream_${status}`,
    });
    const clientStatus = status === 400 || status === 429 || status === 503 ? status : 502;
    const detail = auth.listing.kind === "compute" && error instanceof BackendError ? `${error.message}. ` : "";
    return openAiError(clientStatus, "upstream_error", `${detail || "The model backend failed. "}You were not charged.`);
  }
}
