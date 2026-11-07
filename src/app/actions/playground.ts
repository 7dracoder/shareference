"use server";
import { requireUser } from "@/lib/auth";
import { getGrant, revealKey } from "@/lib/grants";
import { getListing } from "@/lib/listings";
import { str, type ActionState } from "@/lib/form";
import { POST } from "@/app/api/v1/chat/completions/route";

export async function tryAccessAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser("/playground");
  const grant = await getGrant(str(form, "grantId"));
  if (!grant || grant.buyerId !== user.id || grant.status !== "active") return { error: "Choose your active access." };
  const listing = await getListing(grant.listingId);
  if (!listing || !grant.features.includes("chat")) return { error: "This access does not support chat." };
  const prompt = str(form, "prompt");
  if (!prompt || prompt.length > 20_000) return { error: "Enter a message up to 20,000 characters." };
  const key = await revealKey(grant.id, user.id);
  if (!key) return { error: "This key is no longer available." };
  const model = listing.kind === "pool" ? `shareference-${grant.privacyFloor}` : grant.models[0];
  const response = await POST(new Request("http://internal/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: Math.min(400, grant.maxTokensPerRequest), stream: false }) }));
  const body = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
  if (!response.ok) return { error: body.error?.message || "The request failed. Please try again." };
  return { ok: true, message: body.choices?.[0]?.message?.content || "The model returned an empty response." };
}
