import { authorize } from "@/lib/api";
import { TIERS } from "@/lib/pricing";

export async function GET(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if (auth instanceof Response) return auth;
  const isPool = auth.listing.kind === "pool";
  const ids = isPool
    ? TIERS.map((t) => `shareference-${t}`)
    : auth.grant.models.length > 0
      ? auth.grant.models
      : auth.listing.models;
  return Response.json({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", owned_by: isPool ? "shareference" : auth.listing.providerAlias })),
  });
}
