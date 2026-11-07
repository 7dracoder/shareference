import "server-only";
import { TinfoilAI, type VerificationDocument } from "tinfoil";
import { env } from "../env";
import { logger } from "../logger";
import {
  BackendError,
  estimateTokens,
  messagesText,
  SSE_HEADERS,
  type BackendResult,
  type ChatRequest,
  type Usage,
} from "./openai-compat";

/**
 * Tinfoil: the SDK verifies the enclave's attestation before sending anything,
 * then encrypts requests (HPKE) so only the verified enclave can read them.
 */
let client: TinfoilAI | null = null;

function getClient(): TinfoilAI {
  if (!client) client = new TinfoilAI({ apiKey: env.TINFOIL_API_KEY });
  return client;
}

export function tinfoilEnabled(): boolean {
  return Boolean(env.TINFOIL_API_KEY);
}

interface ChunkLike {
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  choices?: Array<{ delta?: { content?: string | null } }>;
}

type CreateParams = Parameters<TinfoilAI["chat"]["completions"]["create"]>[0];

export async function tinfoilChat(request: ChatRequest): Promise<BackendResult> {
  const model = env.TINFOIL_MODEL;
  const params = { ...request, model } as unknown as CreateParams;
  const promptEstimate = estimateTokens(messagesText(request));
  try {
    if (!request.stream) {
      const completion = (await getClient().chat.completions.create({ ...params, stream: false })) as unknown as ChunkLike;
      const usage: Usage = {
        promptTokens: completion.usage?.prompt_tokens ?? promptEstimate,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      };
      return { response: Response.json(completion), usage: Promise.resolve(usage), model };
    }

    const stream = (await getClient().chat.completions.create({
      ...params,
      stream: true,
      stream_options: { include_usage: true },
    } as CreateParams)) as unknown as AsyncIterable<ChunkLike>;

    let resolveUsage: (u: Usage) => void = () => {};
    const usage = new Promise<Usage>((resolve) => {
      resolveUsage = resolve;
    });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let chars = 0;
        let reported: ChunkLike["usage"] = null;
        try {
          for await (const chunk of stream) {
            reported = chunk.usage ?? reported;
            chars += (chunk.choices ?? []).map((c) => c.delta?.content ?? "").join("").length;
            controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
        } catch (error: unknown) {
          logger.error("tinfoil stream error", { error: String(error) });
        } finally {
          resolveUsage({
            promptTokens: reported?.prompt_tokens ?? promptEstimate,
            completionTokens: reported?.completion_tokens ?? Math.ceil(chars / 4),
          });
          controller.close();
        }
      },
    });
    return { response: new Response(body, { headers: SSE_HEADERS }), usage, model };
  } catch (error: unknown) {
    throw new BackendError(`Tinfoil request failed: ${String(error)}`, 502, true);
  }
}

export interface TinfoilVerification {
  configured: boolean;
  verified: boolean;
  steps: Record<string, string>;
  enclaveHost?: string;
  codeDigest?: string;
  configRepo?: string;
  releaseTag?: string;
  error?: string;
}

export async function verifyTinfoil(): Promise<TinfoilVerification> {
  if (!tinfoilEnabled()) return { configured: false, verified: false, steps: {} };
  try {
    const c = getClient();
    await c.ready();
    const doc: VerificationDocument = await c.getVerificationDocument();
    const steps = Object.fromEntries(
      Object.entries(doc.steps ?? {}).map(([k, v]) => {
        const state = v as unknown;
        const status =
          state && typeof state === "object" && "status" in state ? String((state as { status: unknown }).status) : "unknown";
        return [k, status];
      }),
    );
    return {
      configured: true,
      verified: doc.securityVerified,
      steps,
      enclaveHost: doc.enclaveHost,
      codeDigest: doc.releaseDigest,
      configRepo: doc.configRepo,
      releaseTag: doc.releaseTag,
    };
  } catch (error: unknown) {
    return { configured: true, verified: false, steps: {}, error: String(error) };
  }
}
