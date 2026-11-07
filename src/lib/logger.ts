import "server-only";

type Level = "info" | "warn" | "error";

/** Minimal structured logger. Never pass prompts, outputs, or secrets in `meta`. */
function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ level, message, ...meta, time: new Date().toISOString() });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
