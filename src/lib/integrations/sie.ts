import "server-only";
import { env } from "../env";
import { logger } from "../logger";
import { BackendError, callOpenAiCompatible, type BackendResult, type ChatRequest } from "./openai-compat";

/**
 * Superlinked SIE: small open models behind one API.
 * Native endpoints: /v1/encode/:model, /v1/score/:model, /v1/extract/:model.
 * OpenAI-compatible: /v1/embeddings, /v1/chat/completions.
 */
const PII_LABELS = ["person", "email", "phone number", "address", "credit card number", "social security number", "password", "api key"];
const PII_THRESHOLD = 0.5;
const PII_MAX_CHARS = 2000;

export function sieEnabled(): boolean {
  return Boolean(env.SIE_BASE_URL);
}

function base(): string {
  return `${(env.SIE_BASE_URL ?? "").replace(/\/$/, "")}/v1`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.SIE_API_KEY) h.Authorization = `Bearer ${env.SIE_API_KEY}`;
  return h;
}

async function post(path: string, body: unknown, timeoutMs = 30_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    throw new BackendError(`SIE unreachable: ${String(error)}`, 502, true);
  }
  if (!res.ok) throw new BackendError(`SIE returned ${res.status}`, res.status, res.status >= 500);
  return res.json();
}

export function sieChat(request: ChatRequest): Promise<BackendResult> {
  return callOpenAiCompatible({
    baseUrl: base(),
    apiKey: env.SIE_API_KEY ?? "",
    model: env.SIE_CHAT_MODEL,
    request,
  });
}

export function sieEmbeddings(input: string | string[], model?: string): Promise<unknown> {
  return post("/embeddings", { model: model ?? env.SIE_EMBED_MODEL, input });
}

export interface RerankResult {
  scores: Array<{ item_id: string | null; score: number; rank: number }>;
}

export async function sieRerank(query: string, documents: string[], model?: string): Promise<RerankResult> {
  const m = model ?? env.SIE_RERANK_MODEL;
  const body = {
    query: { text: query },
    items: documents.map((text, i) => ({ id: String(i), text })),
  };
  return (await post(`/score/${m}`, body)) as RerankResult;
}

export interface PiiScan {
  found: boolean;
  labels: string[];
  checked: boolean;
}

/**
 * Detects personal data with a GLiNER model on SIE. Used by the router to
 * upgrade sensitive requests to the verified (Tinfoil) tier. The text is
 * processed in memory only and never stored.
 */
export async function detectPii(text: string): Promise<PiiScan> {
  if (!sieEnabled() || text.trim() === "") return { found: false, labels: [], checked: false };
  try {
    const result = (await post(
      `/extract/${env.SIE_PII_MODEL}`,
      { items: [{ text: text.slice(-PII_MAX_CHARS) }], params: { labels: PII_LABELS } },
      5000,
    )) as { items?: Array<{ entities?: Array<{ label: string; score: number }> }> };
    const entities = result.items?.[0]?.entities ?? [];
    const labels = [...new Set(entities.filter((e) => e.score >= PII_THRESHOLD).map((e) => e.label))];
    return { found: labels.length > 0, labels, checked: true };
  } catch (error: unknown) {
    logger.warn("PII scan failed; treating as unchecked", { error: String(error) });
    return { found: false, labels: [], checked: false };
  }
}
