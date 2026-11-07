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

export const SERVICE_POLICIES: readonly ServicePolicy[] = [
  {
    id: "openai-compatible",
    name: "OpenAI-compatible inference API",
    rule: "api_org",
    note: "Only provide access you are authorized to resell or share. Check your service agreement.",
    kinds: ["api_key"],
  },
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
  {
    id: "personal-login",
    name: "Personal account login (any service)",
    rule: "forbidden",
    note: "Sharing a personal login usually violates the vendor's terms. Not supported.",
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
