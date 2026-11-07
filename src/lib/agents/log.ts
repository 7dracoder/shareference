import "server-only";
import { db, now } from "../db";
import { newId } from "../crypto";
import { remember, type MemoryDataset } from "../integrations/cognee";

export type AgentName = "policy-guard" | "enforcer" | "router" | "finance" | "reclaim" | "optimizer" | "sales";

/** Datasets each agent may write to in shared memory (its permission scope). */
const AGENT_MEMORY: Record<AgentName, MemoryDataset | null> = {
  "policy-guard": "sb_access",
  enforcer: "sb_access",
  router: "sb_routing",
  finance: "sb_finance",
  reclaim: "sb_access",
  optimizer: null,
  sales: "sb_customers",
};

export interface AgentEvent {
  id: string;
  agent: AgentName;
  action: string;
  detail: string;
  createdAt: number;
}

/** Records an agent action locally and in the agent's cognee dataset. Metadata only. */
export function agentLog(agent: AgentName, action: string, detail: string): void {
  const createdAt = now();
  db.prepare("INSERT INTO agent_events (id, agent, action, detail, created_at) VALUES (?, ?, ?, ?, ?)").run(
    newId("evt"),
    agent,
    action,
    detail,
    createdAt,
  );
  const dataset = AGENT_MEMORY[agent];
  if (dataset) remember(dataset, `[${new Date(createdAt).toISOString()}] ${agent} ${action}: ${detail}`);
}

export function recentAgentEvents(limit = 50): AgentEvent[] {
  const rows = db
    .prepare("SELECT * FROM agent_events ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{ id: string; agent: AgentName; action: string; detail: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, agent: r.agent, action: r.action, detail: r.detail, createdAt: r.created_at }));
}
