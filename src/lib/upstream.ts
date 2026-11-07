import "server-only";

const DEFAULT_HOSTS = ["api.openai.com", "api.groq.com", "api.together.xyz", "api.deepinfra.com", "openrouter.ai", "api.darkbloom.dev", "inference.tinfoil.sh"];

/** Exact trusted hosts prevent DNS rebinding and private-network proxying. */
export function allowedUpstream(value: string): boolean {
  try {
    const url = new URL(value);
    const additional = (process.env.PROVIDER_UPSTREAM_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443")
      && [...DEFAULT_HOSTS, ...additional].includes(url.hostname.toLowerCase());
  } catch { return false; }
}
