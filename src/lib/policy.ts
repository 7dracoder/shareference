import "server-only";

/**
 * Policy registry: which services allow shared access, and how.
 * The registry controls supported integrations; it does not establish resale rights.
 * Review vendor terms before adding entries; this list is a starting point.
 */
export type SharingRule = "api_org" | "team_seat" | "forbidden";

export interface ServicePolicy {
  id: string;
  name: string;
  rule: SharingRule;
  note: string;
  kinds: ReadonlyArray<"api_key" | "seat">;
  /** Fixed OpenAI-compatible API address, so providers only paste their key. */
  baseUrl?: string;
}

const API_NOTE = "Only share API credit your provider's terms allow you to share. Check your service agreement.";

function api(id: string, name: string, baseUrl: string): ServicePolicy {
  return { id, name, rule: "api_org", note: API_NOTE, kinds: ["api_key"], baseUrl };
}

function seat(id: string, name: string, admin: string): ServicePolicy {
  return { id, name, rule: "team_seat", note: `Team or business plan seats only. You add the buyer in ${admin}, and remove them when the time ends.`, kinds: ["seat"] };
}

export const SERVICE_POLICIES: readonly ServicePolicy[] = [
  api("anthropic", "Claude API (Anthropic)", "https://api.anthropic.com/v1"),
  api("openai", "OpenAI API", "https://api.openai.com/v1"),
  api("gemini", "Google Gemini API", "https://generativelanguage.googleapis.com/v1beta/openai"),
  api("baseten", "Baseten Model APIs", "https://inference.baseten.co/v1"),
  api("openrouter", "OpenRouter", "https://openrouter.ai/api/v1"),
  api("groq", "Groq", "https://api.groq.com/openai/v1"),
  api("together", "Together AI", "https://api.together.xyz/v1"),
  api("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1"),
  api("deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai"),
  api("mistral", "Mistral AI", "https://api.mistral.ai/v1"),
  api("xai", "xAI (Grok) API", "https://api.x.ai/v1"),
  api("deepseek", "DeepSeek API", "https://api.deepseek.com/v1"),
  api("cerebras", "Cerebras", "https://api.cerebras.ai/v1"),
  api("perplexity", "Perplexity API", "https://api.perplexity.ai"),
  api("cohere", "Cohere", "https://api.cohere.ai/compatibility/v1"),
  api("huggingface", "Hugging Face Inference", "https://router.huggingface.co/v1"),
  api("nebius", "Nebius AI Studio", "https://api.studio.nebius.com/v1"),
  api("sambanova", "SambaNova Cloud", "https://api.sambanova.ai/v1"),
  api("novita", "Novita AI", "https://api.novita.ai/v3/openai"),
  {
    id: "darkbloom",
    name: "Darkbloom credits",
    rule: "api_org",
    note: "Provide Darkbloom access only if your service agreement permits it.",
    kinds: ["api_key"],
    baseUrl: "https://api.darkbloom.dev/v1",
  },
  {
    id: "tinfoil",
    name: "Tinfoil inference",
    rule: "api_org",
    note: "Provide Tinfoil access only if your service agreement permits it.",
    kinds: ["api_key"],
    baseUrl: "https://inference.tinfoil.sh/v1",
  },
  {
    id: "openai-compatible",
    name: "Other OpenAI-compatible API (or your own server)",
    rule: "api_org",
    note: "Only provide access you are authorized to resell or share. Hosts outside this list must be enabled by the platform owner.",
    kinds: ["api_key"],
  },
  seat("claude-team", "Claude Team seat", "your Claude Team admin settings"),
  seat("chatgpt-business", "ChatGPT Business seat", "your ChatGPT workspace settings"),
  seat("cursor-teams", "Cursor Teams seat", "your Cursor team dashboard"),
  seat("copilot-business", "GitHub Copilot Business seat", "your GitHub organization settings"),
  {
    id: "canva-teams",
    name: "Canva Teams seat",
    rule: "team_seat",
    note: "Team plan seats only. The owner assigns the seat in Canva's admin console; Shareference tracks time; you must manually remove the seat.",
    kinds: ["seat"],
  },
  {
    id: "figma-org",
    name: "Figma team seat",
    rule: "team_seat",
    note: "Team/org plan seats only, assigned by the plan admin.",
    kinds: ["seat"],
  },
  {
    id: "notion-team",
    name: "Notion team seat",
    rule: "team_seat",
    note: "Team plan seats only, assigned by the workspace admin.",
    kinds: ["seat"],
  },
  seat("other-team-seat", "Other team-plan seat", "that service's admin console"),
  {
    id: "personal-login",
    name: "Personal subscription or login (Claude Pro/Max, ChatGPT Plus, etc.)",
    rule: "forbidden",
    note: "Sharing a personal subscription means sharing your login, which these services forbid and can ban accounts for. Share API credit or a team-plan seat instead.",
    kinds: [],
  },
];

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  policy?: ServicePolicy;
}

export function checkPolicy(serviceId: string, kind: "api_key" | "seat"): PolicyDecision {
  const policy = SERVICE_POLICIES.find((p) => p.id === serviceId);
  if (!policy) return { allowed: false, reason: "Unknown service. Ask the platform admin to review its terms first." };
  if (policy.rule === "forbidden") return { allowed: false, reason: policy.note, policy };
  if (!policy.kinds.includes(kind)) {
    return { allowed: false, reason: `${policy.name} cannot be shared as ${kind === "seat" ? "a seat" : "an API key"}.`, policy };
  }
  return { allowed: true, reason: policy.note, policy };
}
