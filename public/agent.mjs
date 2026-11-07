#!/usr/bin/env node
// Shareference computer agent.
// Shares the AI models running on this machine (Ollama or LM Studio) with buyers
// who paid for time on it. Stop sharing at any time with Ctrl+C.
//
// Usage: node shareference-agent.mjs <token> <server URL>
// Optional: LOCAL_AI_URL=http://127.0.0.1:11434/v1 to point at a different local server.
// Needs Node.js 18 or newer. No other dependencies.

import os from "node:os";
import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";

const [token, server] = process.argv.slice(2);
if (!token || !server) {
  console.error("Usage: node shareference-agent.mjs <token> <server URL>");
  process.exit(1);
}
const SERVER = server.replace(/\/$/, "");
const LOCAL_CANDIDATES = process.env.LOCAL_AI_URL
  ? [process.env.LOCAL_AI_URL.replace(/\/$/, "")]
  : ["http://127.0.0.1:11434/v1", "http://127.0.0.1:1234/v1"];
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function detectGpu() {
  const nvidia = run("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"]);
  if (nvidia) return nvidia.split("\n").map((l) => l.trim()).join("; ");
  if (process.platform === "darwin") {
    const chip = run("sysctl", ["-n", "machdep.cpu.brand_string"]);
    if (chip.startsWith("Apple")) return `${chip} GPU (shares system memory)`;
  }
  if (process.platform === "win32") {
    return run("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"]).split(/\r?\n/).filter(Boolean).join("; ");
  }
  return run("sh", ["-c", "lspci 2>/dev/null | grep -iE 'vga|3d' | head -1 | cut -d: -f3"]);
}

function readSpecs() {
  const cpus = os.cpus();
  let freeDiskGb;
  try {
    const s = statfsSync(os.homedir());
    freeDiskGb = Math.round((s.bavail * s.bsize) / 1e9);
  } catch {}
  return {
    os: `${os.type()} ${os.release()} (${os.arch()})`.slice(0, 120),
    cpu: cpus[0]?.model?.trim().slice(0, 160),
    cores: cpus.length || undefined,
    ramGb: Math.round(os.totalmem() / 2 ** 30),
    gpu: detectGpu().slice(0, 200) || undefined,
    freeDiskGb,
  };
}

let local = null;
/** @type {"missing" | "empty" | "ok"} */
let localStatus = "missing";

async function listModels() {
  let reached = false;
  for (const base of local ? [local] : LOCAL_CANDIDATES) {
    try {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      reached = true;
      const json = await res.json();
      const ids = (json.data ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id).slice(0, 200);
      if (ids.length) {
        local = base;
        localStatus = "ok";
        return ids;
      }
      // OpenAI-compatible list can be empty while Ollama's native tags still has models.
      if (base.includes(":11434")) {
        try {
          const tags = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
          if (tags.ok) {
            const body = await tags.json();
            const fromTags = (body.models ?? []).map((m) => m.name).filter((id) => typeof id === "string" && id).slice(0, 200);
            if (fromTags.length) {
              local = base;
              localStatus = "ok";
              return fromTags;
            }
          }
        } catch {}
      }
      local = base;
      localStatus = "empty";
    } catch {}
  }
  if (!reached) {
    local = null;
    localStatus = "missing";
  }
  return [];
}

async function answer(job) {
  const started = Date.now();
  let result;
  try {
    const res = await fetch(`${local}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job.request),
      signal: AbortSignal.timeout(100_000),
    });
    result = res.ok ? { response: await res.json() } : { errorStatus: res.status >= 400 && res.status < 600 ? res.status : 502 };
  } catch {
    result = { errorStatus: 502 };
  }
  await fetch(`${SERVER}/api/node/jobs/${job.id}`, { method: "POST", headers, body: JSON.stringify(result) }).catch(() => {});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${new Date().toLocaleTimeString()}  ${result.response ? "answered" : "failed"} a request for ${job.request.model} (${seconds}s)`);
}

const specs = readSpecs();
console.log(`Sharing this computer on Shareference: ${specs.cpu ?? "CPU"}, ${specs.ramGb} GB RAM${specs.gpu ? `, ${specs.gpu}` : ""}.`);
console.log("Buyers' prompts run on this machine. Shareference doesn't keep them. Press Ctrl+C to stop sharing.");

let lastModels = "";
for (;;) {
  const models = await listModels();
  const summary = models.length
    ? `Models available: ${models.join(", ")}`
    : localStatus === "empty"
      ? "Ollama/LM Studio is running, but no models are installed. Run: ollama pull llama3.2:3b"
      : "No local AI server. Start Ollama (`ollama serve`) or LM Studio's local server, then: ollama pull llama3.2:3b";
  if (summary !== lastModels) {
    console.log(summary);
    lastModels = summary;
  }
  let res;
  try {
    res = await fetch(`${SERVER}/api/node/poll`, { method: "POST", headers, body: JSON.stringify({ specs, models }), signal: AbortSignal.timeout(45_000) });
  } catch {
    console.log("Can't reach Shareference. Retrying in 5 seconds.");
    await sleep(5_000);
    continue;
  }
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    console.error(body.error ?? "This token is no longer valid. Get a new command from your provider page.");
    process.exit(1);
  }
  if (res.status === 200) {
    answer(await res.json());
  } else if (res.status !== 204) {
    await sleep(5_000);
  }
}
