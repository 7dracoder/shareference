import "server-only";

/**
 * Policy registry: which services allow shared access, and how.
 * Switchboard refuses listings that would break a vendor's terms.
 * Review vendor terms before adding entries; this list is a starting point.
 */
export type SharingRule = "api_org" | "team_seat" | "forbidden";

export interface ServicePolicy {
  id: string;
  name: string;
  rule: SharingRule;
  note: string;
  kinds: ReadonlyArray<"api_key" | "seat">;
}

export const SERVICE_POLICIES: readonly ServicePolicy[] = [
  {
    id: "openai-compatible",
    name: "OpenAI-compatible inference API",
    rule: "api_org",
    note: "Share inside your team or org. The key stays sealed in the vault; members get capped sub-keys.",
    kinds: ["api_key"],
  },
  {
    id: "darkbloom",
    name: "Darkbloom credits",
    rule: "api_org",
    note: "Share Darkbloom inference credits with capped sub-keys.",
    kinds: ["api_key"],
  },
  {
    id: "tinfoil",
    name: "Tinfoil inference",
    rule: "api_org",
    note: "Share Tinfoil inference with capped sub-keys.",
    kinds: ["api_key"],
  },
  {
    id: "canva-teams",
    name: "Canva Teams seat",
    rule: "team_seat",
    note: "Team plan seats only. The owner assigns the seat in Canva's admin console; Switchboard tracks time and reclaims it.",
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
