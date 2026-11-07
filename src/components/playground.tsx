"use client";

import { useState, type FormEvent } from "react";

interface Result {
  status: number;
  backend: string | null;
  tier: string | null;
  text: string;
  ms: number;
}

function extractText(body: unknown): string {
  if (!body || typeof body !== "object") return String(body);
  const b = body as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string; code?: string } };
  if (b.error) return `${b.error.code ?? "error"}: ${b.error.message ?? ""}`;
  const content = b.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : JSON.stringify(body, null, 2);
}

export function Playground() {
  const [key, setKey] = useState("");
  const [tier, setTier] = useState("auto");
  const [prompt, setPrompt] = useState("Write a one-line pitch for a private AI marketplace.");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const started = performance.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` };
      if (tier !== "auto") headers["x-switchboard-tier"] = tier;
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 400 }),
      });
      const body: unknown = await res.json().catch(() => ({ error: { message: "Non-JSON response" } }));
      setResult({
        status: res.status,
        backend: res.headers.get("x-switchboard-backend"),
        tier: res.headers.get("x-switchboard-tier"),
        text: extractText(body),
        ms: Math.round(performance.now() - started),
      });
    } catch (error: unknown) {
      setResult({ status: 0, backend: null, tier: null, text: String(error), ms: 0 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={send} className="card space-y-4">
        <label className="block">
          <span className="label">Switchboard key</span>
          <input className="input font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_…" required autoComplete="off" />
        </label>
        <label className="block">
          <span className="label">Tier (pool keys)</span>
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="auto">Auto (key&apos;s privacy floor)</option>
            <option value="fast">Fast · SIE</option>
            <option value="private">Private · Darkbloom</option>
            <option value="verified">Verified · Tinfoil</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Message</span>
          <textarea className="input" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
      </form>
      <div className="card">
        <h2 className="kicker">Response</h2>
        {result ? (
          <div className="mt-3 space-y-3">
            <p className="font-mono text-xs text-mid">
              HTTP {result.status} · backend {result.backend ?? "—"} · tier {result.tier ?? "—"} · {result.ms} ms
            </p>
            <pre className="code whitespace-pre-wrap">{result.text}</pre>
          </div>
        ) : (
          <p className="mt-3 text-sm text-low">Nothing sent yet.</p>
        )}
      </div>
    </div>
  );
}
