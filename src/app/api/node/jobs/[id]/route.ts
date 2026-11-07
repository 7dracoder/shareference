import { z } from "zod";
import { readJson } from "@/lib/api";
import { finishJob, nodeIdForToken } from "@/lib/nodes";

const bodySchema = z.union([
  z.object({ response: z.record(z.string(), z.unknown()) }),
  z.object({ errorStatus: z.number().int().min(400).max(599) }),
]);

/** The computer agent posts the model's answer (or an error status) for a request it claimed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const token = /^Bearer\s+(shn_[A-Za-z0-9_-]{20,})$/.exec((req.headers.get("authorization") ?? "").trim())?.[1];
  const nodeId = token ? await nodeIdForToken(token) : null;
  if (!nodeId) return Response.json({ error: "Unknown computer token" }, { status: 401 });
  let body;
  try {
    body = bodySchema.parse(await readJson(req, 2_000_000));
  } catch {
    return Response.json({ error: "Invalid result" }, { status: 400 });
  }
  const { id } = await params;
  const saved = await finishJob(nodeId, id, body);
  return saved ? Response.json({ ok: true }) : Response.json({ error: "This request is no longer waiting" }, { status: 410 });
}
