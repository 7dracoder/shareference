import "server-only";
import { env } from "../env";
import { callOpenAiCompatible, type BackendResult, type ChatRequest } from "./openai-compat";

/** OpenRouter: general-purpose chat for the pool's fast tier. */
export function openrouterEnabled(): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

export function openrouterChat(request: ChatRequest): Promise<BackendResult> {
  return callOpenAiCompatible({
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY ?? "",
    model: env.OPENROUTER_MODEL,
    request,
  });
}
