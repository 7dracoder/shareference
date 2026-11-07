import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedUpstream } from "../src/lib/upstream";
import { readJson } from "../src/lib/api";
import { meterSseStream } from "../src/lib/integrations/openai-compat";

test("upstream URLs reject credentials, redirects' alternate hosts, IPs, and private hosts", () => {
  for (const value of ["http://api.openai.com/v1", "https://127.0.0.1", "https://[::1]", "https://api.openai.com.attacker.test", "https://localhost", "https://user:password@api.openai.com/v1", "https://api.openai.com:8443/v1", "https://api.openai.com/v1?key=secret"]) assert.equal(allowedUpstream(value), false, value);
  assert.equal(allowedUpstream("https://api.openai.com/v1"), true);
  for (const value of ["https://api.anthropic.com/v1", "https://inference.baseten.co/v1", "https://generativelanguage.googleapis.com/v1beta/openai"]) assert.equal(allowedUpstream(value), true, value);
});

test("request-body limits count UTF-8 bytes and stop chunked uploads", async () => {
  const req = new Request("https://example.test", { method: "POST", body: JSON.stringify({ text: "é".repeat(10) }) });
  await assert.rejects(() => readJson(req, 20));
  assert.deepEqual(await readJson(new Request("https://example.test", { method: "POST", body: '{"ok":true}' })), { ok: true });
});

test("SSE metering handles split UTF-8 events and resolves on cancellation", async () => {
  const enc = new TextEncoder();
  const payload = enc.encode('data: {"choices":[{"delta":{"content":"héllo"}}]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n');
  const source = new ReadableStream<Uint8Array>({ start(c) { for (let i=0;i<payload.length;i+=3) c.enqueue(payload.slice(i,i+3)); c.close(); } });
  const metered = meterSseStream(source, 50);
  assert.equal(await new Response(metered.stream).text(), new TextDecoder().decode(payload));
  assert.deepEqual(await metered.usage, { promptTokens: 7, completionTokens: 2 });
  let canceled = false;
  const open = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')); }, cancel() { canceled = true; } });
  const interrupted = meterSseStream(open, 5);
  const reader = interrupted.stream.getReader();
  await reader.read(); await reader.cancel();
  assert.equal(canceled, true);
  assert.deepEqual(await interrupted.usage, { promptTokens: 5, completionTokens: 2 });
});
