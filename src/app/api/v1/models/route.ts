import { authorize } from "@/lib/api";
import { TIERS } from "@/lib/pricing";
import { getNode } from "@/lib/nodes";

export async function GET(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if (auth instanceof Response) return auth;
  const isPool = auth.listing.kind === "pool";
  const node = auth.listing.kind === "compute" && auth.listing.nodeId ? await getNode(auth.listing.nodeId) : null;
  const ids = isPool
    ? TIERS.map((t) => `shareference-${t}`)
    : node
      ? node.models
      : auth.grant.models.length > 0
      ? auth.grant.models
      : auth.listing.models;
  return Response.json({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", owned_by: isPool ? "shareference" : auth.listing.providerAlias })),
  });
}
