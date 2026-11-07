import "server-only";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Used once to show a revealed secret (e.g. an API key) to its owner. */
  secret?: string;
}

export const initialState: ActionState = {};

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function num(form: FormData, key: string, fallback = 0): number {
  const n = Number(str(form, key));
  return Number.isFinite(n) ? n : fallback;
}

export function list(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    .map((v) => v.trim())
    .filter(Boolean);
}

const attempts = new Map<string, number[]>();

/** Small in-memory limiter for auth endpoints (per key, sliding window). */
export function allow(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const recent = (attempts.get(key) ?? []).filter((ts) => t - ts < windowMs);
  if (recent.length >= max) {
    attempts.set(key, recent);
    return false;
  }
  attempts.set(key, [...recent, t]);
  return true;
}
