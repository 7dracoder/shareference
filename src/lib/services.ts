import { SERVICE_POLICIES } from "./policy";

/** Display name for a listing's service id. Falls back to the raw id. */
export function serviceName(id: string): string {
  if (id === "shareference-pool") return "Shareference pool";
  return SERVICE_POLICIES.find((p) => p.id === id)?.name ?? id;
}
