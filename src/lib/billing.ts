import "server-only";
import { tx, now } from "./db";
import { newId } from "./crypto";

/** Reserve before inference. A row lock serializes budget checks across instances. */
export async function reserveBudget(grantId: string, amountMicros: number): Promise<string | null> {
  if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) throw new Error("Invalid reservation");
  return tx(async (t) => {
    const grant = await t.get<{ status: string; budget_micros: number; spent_micros: number; expires_at: number | null; starts_at: number }>("SELECT status, budget_micros, spent_micros, expires_at, starts_at FROM grants WHERE id = ? FOR UPDATE", [grantId]);
    const ts = now();
    if (!grant || grant.status !== "active" || grant.starts_at > ts || (grant.expires_at !== null && grant.expires_at <= ts)) return null;
    const reserved = await t.get<{ total: number }>("SELECT COALESCE(SUM(amount_micros), 0) AS total FROM usage_reservations WHERE grant_id = ? AND expires_at > ?", [grantId, ts]);
    if (grant.spent_micros + (reserved?.total ?? 0) + amountMicros > grant.budget_micros) return null;
    const id = newId("res");
    await t.run("INSERT INTO usage_reservations (id, grant_id, amount_micros, expires_at) VALUES (?, ?, ?, ?)", [id, grantId, amountMicros, ts + 300_000]);
    return id;
  });
}
