import "server-only";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Shared agent memory on cognee. Each dataset is a permission boundary:
 * agents write to and read from only the datasets their role needs.
 * Only metadata goes in here. Prompts and outputs never do.
 */
export type MemoryDataset = "sb_routing" | "sb_customers" | "sb_finance" | "sb_access";

const TIMEOUT_MS = 8000;

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { "X-Api-Key": env.COGNEE_API_KEY ?? "" };
  if (env.COGNEE_TENANT_ID) h["X-Tenant-Id"] = env.COGNEE_TENANT_ID;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export function cogneeEnabled(): boolean {
  return Boolean(env.COGNEE_BASE_URL && env.COGNEE_API_KEY);
}

/** Fire-and-forget write. Never blocks or fails the caller. */
export function remember(dataset: MemoryDataset, fact: string): void {
  if (!cogneeEnabled()) return;
  const form = new FormData();
  form.append("datasetName", dataset);
  form.append("raw_data", fact);
  fetch(`${env.COGNEE_BASE_URL}/api/v1/remember`, {
    method: "POST",
    headers: headers(false),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) logger.warn("cognee remember failed", { status: res.status, dataset });
    })
    .catch((error: unknown) => logger.warn("cognee remember error", { error: String(error), dataset }));
}

export async function recall(datasets: MemoryDataset[], query: string): Promise<string | null> {
  if (!cogneeEnabled()) return null;
  try {
    const res = await fetch(`${env.COGNEE_BASE_URL}/api/v1/search`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ query, search_type: "GRAPH_COMPLETION", datasets }),
      signal: AbortSignal.timeout(TIMEOUT_MS * 3),
    });
    if (!res.ok) {
      logger.warn("cognee search failed", { status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    return typeof body === "string" ? body : JSON.stringify(body).slice(0, 4000);
  } catch (error: unknown) {
    logger.warn("cognee search error", { error: String(error) });
    return null;
  }
}
