import "server-only";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Fixed-window counter stored in Postgres, so limits hold across serverless
 * instances. Returns true when the call is allowed.
 * Fails closed on database errors so a limiter outage cannot bypass provider limits.
 */
export async function hit(bucket: string, max: number, windowMs: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  try {
    const row = await db.get<{ hits: number }>(
      `INSERT INTO rate_hits (bucket, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_hits.hits + 1
       RETURNING hits`,
      [bucket, windowStart],
    );
    if (Math.random() < 0.01) {
      db.run("DELETE FROM rate_hits WHERE window_start < ?", [Date.now() - 24 * 60 * 60 * 1000]).catch(() => {});
    }
    return (row?.hits ?? 0) <= max;
  } catch (error: unknown) {
    logger.warn("rate limiter unavailable", { error: String(error), bucket });
    return false;
  }
}
