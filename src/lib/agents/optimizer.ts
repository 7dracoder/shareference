import "server-only";
import { db } from "../db";
import { recall } from "../integrations/cognee";
import { formatUsd } from "../pricing";

export interface Insight {
  title: string;
  detail: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_BUDGET_RATIO = 0.8;

/**
 * Optimizer agent: reads the metering ledger (metadata only) and shared
 * memory, and suggests changes. It never sees prompts or outputs.
 */
export async function ledgerInsights(): Promise<Insight[]> {
  const since = Date.now() - DAY_MS;
  const [tiers, pii, idle, low, blocked] = await Promise.all([
    db.all<{ tier: string; n: number; cost: number }>(
      "SELECT tier, COUNT(*) AS n, COALESCE(SUM(cost_micros),0) AS cost FROM usage_events WHERE outcome = 'ok' AND created_at > ? GROUP BY tier",
      [since],
    ),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage_events WHERE reason = 'pii_upgrade' AND created_at > ?", [since]),
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM grants g WHERE g.status = 'active' AND g.created_at < ?
       AND NOT EXISTS (SELECT 1 FROM usage_events u WHERE u.grant_id = g.id AND u.created_at > ?)`,
      [since, since],
    ),
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM grants WHERE status = 'active' AND budget_micros > 0 AND spent_micros >= budget_micros * ?",
      [LOW_BUDGET_RATIO],
    ),
    db.all<{ reason: string; n: number }>(
      "SELECT reason, COUNT(*) AS n FROM usage_events WHERE outcome = 'blocked' AND created_at > ? GROUP BY reason ORDER BY n DESC LIMIT 3",
      [since],
    ),
  ]);

  const insights: Insight[] = [];
  const total = tiers.reduce((s, t) => s + t.n, 0);
  if (total > 0) {
    insights.push({
      title: "Routing mix (24h)",
      detail: tiers.map((t) => `${t.tier}: ${Math.round((t.n / total) * 100)}% (${formatUsd(t.cost)})`).join(" · "),
    });
  }
  if ((pii?.n ?? 0) > 0) {
    insights.push({ title: "Personal data protected", detail: `${pii?.n} requests contained personal data and were moved to the Tinfoil enclave automatically.` });
  }
  if ((idle?.n ?? 0) > 0) {
    insights.push({ title: "Idle access", detail: `${idle?.n} active grants had no usage in 24h. Owners could reclaim those seats or credits.` });
  }
  if ((low?.n ?? 0) > 0) {
    insights.push({ title: "Top-up opportunity", detail: `${low?.n} buyers have used over ${LOW_BUDGET_RATIO * 100}% of their credit.` });
  }
  if (blocked.length > 0) {
    insights.push({ title: "Most common blocks", detail: blocked.map((b) => `${b.reason} ×${b.n}`).join(" · ") });
  }
  return insights;
}

/** Asks cognee's shared memory what the agents have learned. Null when cognee isn't configured. */
export function memoryInsight(): Promise<string | null> {
  return recall(
    ["sb_routing", "sb_finance", "sb_access"],
    "Summarize in 3 bullet points what the Shareference agents have learned about routing, payments and access limits, and one concrete suggestion.",
  );
}
