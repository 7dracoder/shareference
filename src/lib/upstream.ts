import "server-only";
import { SERVICE_POLICIES } from "./policy";

const DEFAULT_HOSTS = SERVICE_POLICIES.flatMap((p) => (p.baseUrl ? [new URL(p.baseUrl).hostname] : []));

/** Exact trusted hosts prevent DNS rebinding and private-network proxying. */
export function allowedUpstream(value: string): boolean {
  try {
    const url = new URL(value);
    const additional = (process.env.PROVIDER_UPSTREAM_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443")
      && [...DEFAULT_HOSTS, ...additional].includes(url.hostname.toLowerCase());
  } catch { return false; }
}
