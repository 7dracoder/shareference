import { z } from "zod";
import { readJson } from "@/lib/api";
import { checkIn, claimJob, specsSchema } from "@/lib/nodes";

export const maxDuration = 30;

const WAIT_MS = 20_000;

const bodySchema = z.object({
  specs: specsSchema,
  models: z.array(z.string().min(1).max(200)).max(200),
});

/** The computer agent long-polls here: it checks in, then receives the next waiting request. */
export async function POST(req: Request): Promise<Response> {
  const token = /^Bearer\s+(shn_[A-Za-z0-9_-]{20,})$/.exec((req.headers.get("authorization") ?? "").trim())?.[1];
  if (!token) return Response.json({ error: "Missing computer token" }, { status: 401 });
  let body;
  try {
    body = bodySchema.parse(await readJson(req, 64_000));
  } catch {
    return Response.json({ error: "Invalid check-in" }, { status: 400 });
  }
  const nodeId = await checkIn(token, body.specs, body.models);
  if (!nodeId) return Response.json({ error: "Unknown computer token. Get a new command from your provider page." }, { status: 401 });

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && !req.signal.aborted) {
    const job = await claimJob(nodeId);
    if (job) return Response.json(job);
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return new Response(null, { status: 204 });
}
