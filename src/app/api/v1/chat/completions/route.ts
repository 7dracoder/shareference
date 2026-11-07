import { authorize, checkOrBlock, openAiError, readJson } from "@/lib/api";
import { parseTier, routeChat } from "@/lib/agents/router";
import { chatRequestSchema } from "@/lib/integrations/openai-compat";
import { BackendError } from "@/lib/integrations/openai-compat";
import { recordUsage } from "@/lib/grants";
import { costMicros } from "@/lib/pricing";
import { logger } from "@/lib/logger";

const ENDPOINT = "chat.completions";

export async function POST(req: Request): Promise<Response> {
  const auth = authorize(req);
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

  const blocked = checkOrBlock(auth, ENDPOINT, {
    feature: "chat",
    model: auth.listing.kind === "api_key" ? request.model : undefined,
    requestedTokens: request.max_tokens ?? request.max_completion_tokens,
  });
  if (blocked) return blocked;

  // Cap generation at the owner's per-request limit even if the client didn't ask for one.
  const capped = { ...request, max_tokens: Math.min(request.max_tokens ?? auth.grant.maxTokensPerRequest, auth.grant.maxTokensPerRequest) };
  const started = Date.now();
  try {
    // Pool callers pick a tier with the x-switchboard-tier header or model "switchboard-<tier>".
    const tierHint =
      parseTier(req.headers.get("x-switchboard-tier")) ?? parseTier(request.model?.replace(/^switchboard-/, "") ?? null);
    const routed = await routeChat(auth.grant, auth.listing, capped, tierHint);
    routed.usage
      .then((usage) =>
        recordUsage({
          grantId: auth.grant.id,
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
        }),
      )
      .catch((error: unknown) => logger.error("usage metering failed", { error: String(error), grant: auth.grant.id }));

    const headers = new Headers(routed.response.headers);
    headers.set("x-switchboard-backend", routed.backend);
    headers.set("x-switchboard-tier", routed.tier);
    return new Response(routed.response.body, { status: routed.response.status, headers });
  } catch (error: unknown) {
    const status = error instanceof BackendError ? error.status : 502;
    logger.warn("chat routing failed", { grant: auth.grant.id, status, error: String(error) });
    recordUsage({
      grantId: auth.grant.id,
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
    return openAiError(clientStatus, "upstream_error", "The model backend failed. You were not charged.");
  }
}
