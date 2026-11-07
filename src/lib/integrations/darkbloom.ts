import "server-only";
import { env } from "../env";
import { callOpenAiCompatible, type BackendResult, type ChatRequest } from "./openai-compat";

/** Darkbloom: OpenAI-compatible private inference on attested Apple Silicon Macs. */
export function darkbloomEnabled(): boolean {
  return Boolean(env.DARKBLOOM_BASE_URL && env.DARKBLOOM_API_KEY && env.DARKBLOOM_MODEL);
}

export function darkbloomChat(request: ChatRequest): Promise<BackendResult> {
  return callOpenAiCompatible({
    baseUrl: env.DARKBLOOM_BASE_URL ?? "",
    apiKey: env.DARKBLOOM_API_KEY ?? "",
    model: env.DARKBLOOM_MODEL ?? "",
    request,
  });
}
