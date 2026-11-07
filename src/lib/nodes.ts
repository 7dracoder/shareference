import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { db, now, parseJsonArray } from "./db";
import { hashToken, newId } from "./crypto";

/** A computer counts as online if its agent checked in within this window. */
const ONLINE_MS = 60_000;
/** Requests older than this are abandoned; the buyer has already been told it failed. */
export const JOB_TTL_MS = 110_000;

export const specsSchema = z.object({
  os: z.string().max(120).optional(),
  cpu: z.string().max(160).optional(),
  cores: z.number().int().min(1).max(1024).optional(),
  ramGb: z.number().min(0).max(100_000).optional(),
  gpu: z.string().max(200).optional(),
  freeDiskGb: z.number().min(0).max(1_000_000).optional(),
});

export type Specs = z.infer<typeof specsSchema>;

export interface ComputeNode {
  id: string;
  providerId: string;
  specs: Specs;
  models: string[];
  lastSeen: number | null;
  online: boolean;
}

interface NodeRow {
  id: string;
  provider_id: string;
  specs: string;
  models: string;
  last_seen: number | null;
}

function toNode(row: NodeRow): ComputeNode {
  let specs: Specs = {};
  try {
    specs = specsSchema.parse(JSON.parse(row.specs));
  } catch {}
  return {
    id: row.id,
    providerId: row.provider_id,
    specs,
    models: parseJsonArray(row.models),
    lastSeen: row.last_seen,
    online: row.last_seen !== null && now() - row.last_seen < ONLINE_MS,
  };
}

/** Short human-readable spec lines, e.g. "NVIDIA RTX 4090, 24564 MiB", "64 GB RAM". */
export function specLines(specs: Specs): string[] {
  return [
    specs.gpu,
    specs.cpu && `${specs.cpu}${specs.cores ? `, ${specs.cores} cores` : ""}`,
    specs.ramGb !== undefined && `${specs.ramGb} GB RAM`,
    specs.freeDiskGb !== undefined && `${specs.freeDiskGb} GB free disk`,
    specs.os,
  ].filter((line): line is string => Boolean(line));
}

function issueNodeToken(): { token: string; hash: string } {
  const token = `shn_${crypto.randomBytes(24).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

/** Creates a computer for the provider and returns the one-time agent token. */
export async function createNode(providerId: string): Promise<string> {
  const { token, hash } = issueNodeToken();
  await db.run("INSERT INTO nodes (id, provider_id, token_hash, created_at) VALUES (?, ?, ?, ?)", [newId("node"), providerId, hash, now()]);
  return token;
}

/** Replaces the agent token; the old one stops working immediately. */
export async function resetNodeToken(nodeId: string, providerId: string): Promise<string | null> {
  const { token, hash } = issueNodeToken();
  const changes = await db.run("UPDATE nodes SET token_hash = ? WHERE id = ? AND provider_id = ?", [hash, nodeId, providerId]);
  return changes > 0 ? token : null;
}

export async function nodesForProvider(providerId: string): Promise<ComputeNode[]> {
  const rows = await db.all<NodeRow>("SELECT id, provider_id, specs, models, last_seen FROM nodes WHERE provider_id = ? ORDER BY created_at", [providerId]);
  return rows.map(toNode);
}

export async function getNode(id: string): Promise<ComputeNode | null> {
  const row = await db.get<NodeRow>("SELECT id, provider_id, specs, models, last_seen FROM nodes WHERE id = ?", [id]);
  return row ? toNode(row) : null;
}

/** Agent check-in: authenticates the token and records specs and installed models. */
export async function checkIn(token: string, specs: Specs, models: string[]): Promise<string | null> {
  const row = await db.get<{ id: string }>(
    "UPDATE nodes SET specs = ?, models = ?, last_seen = ? WHERE token_hash = ? RETURNING id",
    [JSON.stringify(specs), JSON.stringify(models), now(), hashToken(token)],
  );
  return row?.id ?? null;
}

export async function nodeIdForToken(token: string): Promise<string | null> {
  const row = await db.get<{ id: string }>("SELECT id FROM nodes WHERE token_hash = ?", [hashToken(token)]);
  return row?.id ?? null;
}

/** Hands the oldest waiting request to the agent, or null if there is none. */
export async function claimJob(nodeId: string): Promise<{ id: string; request: unknown } | null> {
  const row = await db.get<{ id: string; request: string }>(
    `UPDATE node_jobs SET status = 'running' WHERE id = (
       SELECT id FROM node_jobs WHERE node_id = ? AND status = 'queued' AND created_at > ?
       ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING id, request`,
    [nodeId, now() - JOB_TTL_MS],
  );
  return row ? { id: row.id, request: JSON.parse(row.request) } : null;
}

export async function finishJob(nodeId: string, jobId: string, result: { response?: unknown; errorStatus?: number }): Promise<boolean> {
  const changes = await db.run(
    "UPDATE node_jobs SET status = ?, response = ?, error_status = ? WHERE id = ? AND node_id = ? AND status = 'running'",
    [result.response === undefined ? "failed" : "done", result.response === undefined ? null : JSON.stringify(result.response), result.errorStatus ?? null, jobId, nodeId],
  );
  return changes > 0;
}

export async function enqueueJob(nodeId: string, request: unknown): Promise<string> {
  const id = newId("job");
  await db.run("DELETE FROM node_jobs WHERE created_at < ?", [now() - 2 * JOB_TTL_MS]);
  await db.run("INSERT INTO node_jobs (id, node_id, request, status, created_at) VALUES (?, ?, ?, 'queued', ?)", [id, nodeId, JSON.stringify(request), now()]);
  return id;
}

/** Waits for the agent's answer, then deletes the row so prompts and outputs aren't kept. */
export async function awaitJob(jobId: string, timeoutMs: number): Promise<{ response?: unknown; errorStatus?: number } | null> {
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const row = await db.get<{ status: string; response: string | null; error_status: number | null }>(
        "SELECT status, response, error_status FROM node_jobs WHERE id = ?",
        [jobId],
      );
      if (row?.status === "done") return { response: JSON.parse(row.response ?? "null") };
      if (row?.status === "failed") return { errorStatus: row.error_status ?? 502 };
      await new Promise((r) => setTimeout(r, 400));
    }
    return null;
  } finally {
    await db.run("DELETE FROM node_jobs WHERE id = ?", [jobId]);
  }
}
