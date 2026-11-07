import "server-only";
import { z } from "zod";

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "developer"]),
  content: z.union([z.string(), z.array(z.unknown()), z.null()]),
}).passthrough();

export const chatRequestSchema = z
  .object({
    model: z.string().max(200).optional(),
    messages: z.array(chatMessageSchema).min(1).max(200),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface BackendResult {
  response: Response;
  /** Resolves once the full response (including streams) has been sent. */
  usage: Promise<Usage>;
  model: string;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function messagesText(req: ChatRequest): string {
  return req.messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")))
    .join("\n");
}

export function lastUserText(req: ChatRequest): string {
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
}

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function readUsage(value: unknown): UsageLike | null {
  if (!value || typeof value !== "object" || !("usage" in value)) return null;
  const usage = (value as { usage: unknown }).usage;
  return usage && typeof usage === "object" ? (usage as UsageLike) : null;
}

function readDeltaText(value: unknown): string {
  if (!value || typeof value !== "object" || !("choices" in value)) return "";
  const choices = (value as { choices: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  return choices
    .map((c: unknown) => {
      const delta = (c as { delta?: { content?: unknown } })?.delta?.content;
      return typeof delta === "string" ? delta : "";
    })
    .join("");
}

/**
 * Wraps an upstream SSE stream: passes bytes through untouched while reading
 * usage (or estimating it from streamed text) for metering.
 */
export function meterSseStream(upstream: ReadableStream<Uint8Array>, promptEstimate: number): {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<Usage>;
} {
  let resolveUsage: (u: Usage) => void = () => {};
  const usage = new Promise<Usage>((resolve) => {
    resolveUsage = resolve;
  });
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedChars = 0;
  let reported: UsageLike | null = null;

  const handleLine = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const parsed: unknown = JSON.parse(data);
      reported = readUsage(parsed) ?? reported;
      streamedChars += readDeltaText(parsed).length;
    } catch {
      // Non-JSON keepalive lines are fine to ignore.
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    },
    flush() {
      if (buffer) handleLine(buffer);
      const r = reported as UsageLike | null;
      resolveUsage({
        promptTokens: r?.prompt_tokens ?? promptEstimate,
        completionTokens: r?.completion_tokens ?? Math.ceil(streamedChars / CHARS_PER_TOKEN),
      });
    },
  });

  return { stream: upstream.pipeThrough(transform), usage };
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  request: ChatRequest;
  timeoutMs?: number;
}

/** Calls any OpenAI-compatible /chat/completions endpoint (Darkbloom, SIE, shared provider keys). */
export async function callOpenAiCompatible(opts: CallOptions): Promise<BackendResult> {
  const body = { ...opts.request, model: opts.model };
  if (body.stream) {
    Object.assign(body, { stream_options: { include_usage: true } });
  }
  const promptEstimate = estimateTokens(messagesText(opts.request));
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (error: unknown) {
    throw new BackendError(`Upstream unreachable: ${String(error)}`, 502, true);
  }
  if (!res.ok || !res.body) {
    const retryable = res.status >= 500 || res.status === 429;
    throw new BackendError(`Upstream returned ${res.status}`, res.status, retryable);
  }
  if (opts.request.stream) {
    const metered = meterSseStream(res.body, promptEstimate);
    return { response: new Response(metered.stream, { headers: SSE_HEADERS }), usage: metered.usage, model: opts.model };
  }
  const json: unknown = await res.json();
  const u = readUsage(json);
  const usage: Usage = {
    promptTokens: u?.prompt_tokens ?? promptEstimate,
    completionTokens: u?.completion_tokens ?? 0,
  };
  return { response: Response.json(json), usage: Promise.resolve(usage), model: opts.model };
}

/** Clearly-labelled stand-in used only when DEMO_MODE is on and a backend has no keys. */
export function mockChat(backend: string, request: ChatRequest): BackendResult {
  const text = `[demo] ${backend} is not configured yet, so this is a placeholder reply. Add its API key in .env.local to get real output.`;
  const usage: Usage = { promptTokens: estimateTokens(messagesText(request)), completionTokens: estimateTokens(text) };
  const model = `${backend}-demo`;
  if (request.stream) {
    const enc = new TextEncoder();
    const chunk = { id: "demo", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: text } }] };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return { response: new Response(stream, { headers: SSE_HEADERS }), usage: Promise.resolve(usage), model };
  }
  return {
    response: Response.json({
      id: "demo",
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens },
    }),
    usage: Promise.resolve(usage),
    model,
  };
}
