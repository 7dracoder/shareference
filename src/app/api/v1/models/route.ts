import { authorize } from "@/lib/api";
import { TIERS } from "@/lib/pricing";

export function GET(req: Request): Response {
  const auth = authorize(req);
  if (auth instanceof Response) return auth;
  const ids =
    auth.listing.kind === "pool"
      ? TIERS.map((t) => `switchboard-${t}`)
      : auth.grant.models.length > 0
        ? auth.grant.models
        : auth.listing.models;
  return Response.json({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", owned_by: auth.listing.kind === "pool" ? "switchboard" : auth.listing.providerAlias })),
  });
}
