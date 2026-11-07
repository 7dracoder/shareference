"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createListing, getListing, setListingStatus } from "@/lib/listings";
import { activateSeat, getGrant, revokeGrant, updateLimits } from "@/lib/grants";
import { canReceivePayments, confirmPlatformReceipt, confirmProviderReceipt, markProviderPaid } from "@/lib/payments";
import { payoutMethodsSchema, setPayoutMethods } from "@/lib/users";
import { allowedUpstream } from "@/lib/upstream";
import { SERVICE_POLICIES } from "@/lib/policy";
import { TIERS, type Tier } from "@/lib/pricing";
import { list, num, str, type ActionState } from "@/lib/form";
import { createNode, nodesForProvider, resetNodeToken } from "@/lib/nodes";
import { env } from "@/lib/env";

export async function savePayoutAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const raw = {
    zelle: str(form, "zelle") || undefined,
    zelleName: str(form, "zelleName") || undefined,
    venmo: str(form, "venmo") || undefined,
    cashapp: str(form, "cashapp") || undefined,
    paypal: str(form, "paypal") || undefined,
    usdc: str(form, "usdc") || undefined,
  };
  const parsed = payoutMethodsSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await setPayoutMethods(user.id, parsed.data);
  revalidatePath("/provider");
  return { ok: true, message: "Payout details saved. Only Shareference uses them to pay you." };
}

const ALLOWED_FEATURES = ["chat", "embeddings", "rerank"] as const;

const listingSchema = z.object({
  kind: z.enum(["api_key", "seat", "compute"]),
  service: z.string().min(1).max(60),
  title: z.string().min(3, "Title is too short").max(100),
  description: z.string().min(10, "Describe what the buyer gets").max(1000),
  features: z.array(z.enum(ALLOWED_FEATURES)).max(3),
  models: z.array(z.string().max(120)).max(20),
  pricePer1kUsd: z.number().min(0).max(1),
  seatPriceUsd: z.number().min(0).max(500),
  seatMinutes: z.number().int().min(0).max(60 * 24 * 31),
  minPurchaseUsd: z.number().min(1).max(500),
  maxRpm: z.number().int().min(1).max(600),
  maxTokensPerRequest: z.number().int().min(16).max(128_000),
  upstreamBaseUrl: z.string().url().startsWith("https://", "Upstream must use https").nullable(),
  credential: z.string().min(8).max(500).nullable(),
  nodeId: z.string().max(60).nullable(),
});

export async function createListingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canReceivePayments(user.payoutMethods)) return { error: "Add a payout method first so Shareference can send you your earnings." };
  if (str(form, "authorizedSharing") !== "on") return { error: "Confirm you are authorized to provide this access." };
  const kind = str(form, "kind");
  const service = str(form, "service");
  const fixedBaseUrl = SERVICE_POLICIES.find((p) => p.id === service)?.baseUrl;
  const compute = kind === "compute";
  const parsed = listingSchema.safeParse({
    kind,
    service: compute ? "own-computer" : service,
    title: str(form, "title"),
    description: str(form, "description"),
    features: compute ? ["chat"] : kind === "seat" ? [] : list(form, "features"),
    models: compute ? [] : list(form, "models"),
    pricePer1kUsd: compute ? 0 : num(form, "pricePer1kUsd"),
    seatPriceUsd: num(form, compute ? "hourlyPriceUsd" : "seatPriceUsd"),
    seatMinutes: compute ? 60 : Math.round(num(form, "seatMinutes")),
    minPurchaseUsd: compute ? Math.max(1, num(form, "hourlyPriceUsd", 1)) : num(form, "minPurchaseUsd", 5),
    maxRpm: Math.round(num(form, "maxRpm", 60)),
    maxTokensPerRequest: Math.round(num(form, "maxTokensPerRequest", 4000)),
    upstreamBaseUrl: kind === "api_key" ? fixedBaseUrl ?? (str(form, "upstreamBaseUrl") || null) : null,
    credential: kind === "api_key" ? str(form, "credential") || null : null,
    nodeId: compute ? str(form, "nodeId") || null : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  if (d.kind === "api_key" && (d.models.length === 0 || d.pricePer1kUsd <= 0 || d.features.some((f) => f !== "chat"))) return { error: "Add at least one model and a positive price. Shared APIs currently support chat." };
  if (d.kind === "api_key" && d.features.length === 0) return { error: "Grant at least one feature." };
  if (d.kind === "seat" && (d.seatPriceUsd < 1 || d.seatMinutes < 15)) return { error: "Seats need a price of at least $1 and at least 15 minutes." };

  if (d.upstreamBaseUrl && !allowedUpstream(d.upstreamBaseUrl)) {
    return { error: "Choose a supported API host. Ask the platform owner to enable another host." };
  }

  const result = await createListing(user.id, {
    kind: d.kind,
    service: d.service,
    title: d.title,
    description: d.description,
    features: d.features,
    models: d.models,
    pricePer1kMicros: Math.round(d.pricePer1kUsd * 1_000_000),
    seatPriceCents: Math.round(d.seatPriceUsd * 100),
    seatMinutes: d.seatMinutes,
    minPurchaseCents: Math.round(d.minPurchaseUsd * 100),
    maxRpm: d.maxRpm,
    maxTokensPerRequest: d.maxTokensPerRequest,
    upstreamBaseUrl: d.upstreamBaseUrl,
    credential: d.credential,
    nodeId: d.nodeId ?? undefined,
  });
  revalidatePath("/provider");
  revalidatePath("/marketplace");
  return result.ok ? { ok: true, message: result.message } : { error: result.message };
}

export async function connectComputerAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const unused = (await nodesForProvider(user.id)).find((n) => n.lastSeen === null);
  const nodeId = str(form, "nodeId") || unused?.id;
  const token = nodeId ? await resetNodeToken(nodeId, user.id) : await createNode(user.id);
  if (!token) return { error: "That computer isn't yours." };
  revalidatePath("/provider");
  return { ok: true, secret: `curl -fsSL ${env.APP_URL}/agent.mjs -o shareference-agent.mjs && node shareference-agent.mjs ${token} ${env.APP_URL}` };
}

export async function toggleListingAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const status = str(form, "status") === "paused" ? "paused" : "active";
  await setListingStatus(str(form, "listingId"), user.id, status);
  revalidatePath("/provider");
  revalidatePath("/marketplace");
}

export async function confirmFeeAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  await confirmPlatformReceipt(str(form, "paymentId"), admin);
  revalidatePath("/ops");
  revalidatePath("/provider");
  revalidatePath("/dashboard");
  revalidatePath("/marketplace");
}

export async function markProviderPaidAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  await markProviderPaid(str(form, "paymentId"), admin);
  revalidatePath("/ops");
  revalidatePath("/provider");
}

export async function confirmProviderPaidAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await confirmProviderReceipt(str(form, "paymentId"), user.id);
  revalidatePath("/provider");
  revalidatePath("/dashboard");
  revalidatePath("/marketplace");
  revalidatePath("/ops");
}

export async function assignSeatAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const grant = await getGrant(str(form, "grantId"));
  const listing = grant ? await getListing(grant.listingId) : null;
  if (grant && listing && listing.providerId === user.id) await activateSeat(grant.id, user.id, listing.seatMinutes);
  revalidatePath("/provider");
}

export async function revokeAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await revokeGrant(str(form, "grantId"), user.id);
  revalidatePath("/provider");
  revalidatePath("/dashboard");
}

const limitsSchema = z.object({
  maxRpm: z.number().int().min(1).max(600),
  maxTokensPerRequest: z.number().int().min(16).max(128_000),
  privacyFloor: z.enum(TIERS as unknown as [Tier, ...Tier[]]),
  expiresInHours: z.number().min(0).max(24 * 90),
});

export async function updateLimitsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = limitsSchema.safeParse({
    maxRpm: Math.round(num(form, "maxRpm")),
    maxTokensPerRequest: Math.round(num(form, "maxTokensPerRequest")),
    privacyFloor: str(form, "privacyFloor") || "private",
    expiresInHours: num(form, "expiresInHours"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const ok = await updateLimits(str(form, "grantId"), user.id, {
    maxRpm: d.maxRpm,
    maxTokensPerRequest: d.maxTokensPerRequest,
    privacyFloor: d.privacyFloor,
    expiresAt: d.expiresInHours > 0 ? Date.now() + d.expiresInHours * 3_600_000 : null,
  });
  revalidatePath("/provider");
  revalidatePath("/dashboard");
  return ok ? { ok: true, message: "Limits updated. They apply to the next request." } : { error: "Use limits within the listing’s allowance and an expiry within 30 days of purchase. Only the owner can change them." };
}
