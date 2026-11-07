import { z } from "zod";
import { authorize, checkOrBlock, openAiError, readJson } from "@/lib/api";
import { recordUsage } from "@/lib/grants";
import { sieEnabled, sieRerank } from "@/lib/integrations/sie";
import { estimateTokens } from "@/lib/integrations/openai-compat";
import { costMicros, TIER_INFO } from "@/lib/pricing";
import { logger } from "@/lib/logger";

const ENDPOINT = "rerank";
const schema = z.object({
  model: z.string().max(200).optional(),
  query: z.string().min(1).max(10_000),
  documents: z.array(z.string().max(20_000)).min(1).max(200),
});

export async function POST(req: Request): Promise<Response> {
  const auth = authorize(req);
  if (auth instanceof Response) return auth;
  if (auth.listing.kind !== "pool") return openAiError(400, "unsupported", "Rerank is available on the Switchboard pool only.");

  let parsed;
  try {
    parsed = schema.safeParse(await readJson(req));
  } catch {
    return openAiError(400, "invalid_json", "Body must be valid JSON under 1 MB.");
  }
  if (!parsed.success) return openAiError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid request");

  const blocked = checkOrBlock(auth, ENDPOINT, { feature: "rerank" });
  if (blocked) return blocked;
  if (!sieEnabled()) return openAiError(503, "backend_unavailable", "Superlinked SIE is not configured.");

  const started = Date.now();
  const tokens = parsed.data.documents.reduce((sum, d) => sum + estimateTokens(d), estimateTokens(parsed.data.query));
  try {
    const result = await sieRerank(parsed.data.query, parsed.data.documents, parsed.data.model);
    recordUsage({
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
    const results = result.scores.map((s) => ({ index: Number(s.item_id), relevance_score: s.score }));
    return Response.json({ results }, { headers: { "x-switchboard-backend": "superlinked-sie" } });
  } catch (error: unknown) {
    logger.warn("rerank failed", { error: String(error) });
    return openAiError(502, "upstream_error", "The rerank backend failed. You were not charged.");
  }
}
