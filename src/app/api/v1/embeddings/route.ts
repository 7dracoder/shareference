import { z } from "zod";
import { authorize, checkOrBlock, openAiError, readJson } from "@/lib/api";
import { recordUsage } from "@/lib/grants";
import { sieEmbeddings, sieEnabled } from "@/lib/integrations/sie";
import { estimateTokens } from "@/lib/integrations/openai-compat";
import { costMicros, TIER_INFO } from "@/lib/pricing";
import { logger } from "@/lib/logger";

const ENDPOINT = "embeddings";
const schema = z.object({
  model: z.string().max(200).optional(),
  input: z.union([z.string().max(100_000), z.array(z.string().max(100_000)).min(1).max(256)]),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if (auth instanceof Response) return auth;
  if (auth.listing.kind !== "pool") {
    return openAiError(400, "unsupported", "Embeddings are available on the Shareference pool only.");
  }

  let parsed;
  try {
    parsed = schema.safeParse(await readJson(req));
  } catch {
    return openAiError(400, "invalid_json", "Body must be valid JSON under 1 MB.");
  }
  if (!parsed.success) return openAiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");

  const blocked = await checkOrBlock(auth, ENDPOINT, { feature: "embeddings" });
  if (blocked) return blocked;
  if (!sieEnabled()) return openAiError(503, "backend_unavailable", "Superlinked SIE is not configured.");

  const started = Date.now();
  const inputs = Array.isArray(parsed.data.input) ? parsed.data.input : [parsed.data.input];
  const tokens = inputs.reduce((sum, s) => sum + estimateTokens(s), 0);
  try {
    const result = await sieEmbeddings(parsed.data.input, parsed.data.model);
    await recordUsage({
      grantId: auth.grant.id,
      endpoint: ENDPOINT,
      backend: "superlinked-sie",
      tier: "fast",
      model: parsed.data.model ?? null,
      promptTokens: tokens,
      completionTokens: 0,
      costMicros: costMicros(tokens, TIER_INFO.fast.pricePer1kMicros),
      latencyMs: Date.now() - started,
      outcome: "ok",
    });
    return Response.json(result, { headers: { "x-shareference-backend": "superlinked-sie" } });
  } catch (error: unknown) {
    logger.warn("embeddings failed", { error: String(error) });
    return openAiError(502, "upstream_error", "The embeddings backend failed. You were not charged.");
  }
}
