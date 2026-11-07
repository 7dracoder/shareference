"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Hash } from "viem";
import { requireUser } from "@/lib/auth";
import { getListing } from "@/lib/listings";
import { cancelOrder, createOrder, markSent, PAY_METHODS, submitUsdcPayment, type PayMethod } from "@/lib/payments";
import { revealKey, revokeGrant } from "@/lib/grants";
import { num, str, type ActionState } from "@/lib/form";

const MAX_PURCHASE_CENTS = 50_000;

export async function buyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const listing = await getListing(str(form, "listingId"));
  if (!listing) return { error: "Listing not found." };
  const method = str(form, "method");
  const isMethod = (PAY_METHODS as readonly string[]).includes(method) || method === "demo";
  if (!isMethod) return { error: "Pick a payment method." };
  const cents = Math.round(num(form, "amountUsd", 0) * 100);
  if (listing.kind !== "seat" && (cents < listing.minPurchaseCents || cents > MAX_PURCHASE_CENTS)) {
    return { error: `Amount must be between $${(listing.minPurchaseCents / 100).toFixed(2)} and $${MAX_PURCHASE_CENTS / 100}.` };
  }
  const result = await createOrder(listing, user, cents, method as PayMethod | "demo");
  if (!result.ok) return { error: result.message };
  redirect(`/orders/${result.paymentId}`);
}

export async function markSentAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(form, "paymentId");
  await markSent(id, user.id);
  revalidatePath(`/orders/${id}`);
}

export async function cancelOrderAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(form, "paymentId");
  await cancelOrder(id, user.id);
  revalidatePath(`/orders/${id}`);
}

const usdcSchema = z.object({
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter the 0x… wallet you paid from"),
  hashes: z
    .array(z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Each transaction hash is 0x + 64 hex characters"))
    .min(1, "Paste at least one transaction hash")
    .max(4),
});

export async function submitUsdcAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const id = str(form, "paymentId");
  const hashes = str(form, "hashes")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  const parsed = usdcSchema.safeParse({ payer: str(form, "payer"), hashes: [...new Set(hashes)] });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const result = await submitUsdcPayment(id, user.id, parsed.data.payer, parsed.data.hashes as Hash[]);
  revalidatePath(`/orders/${id}`);
  return result.ok ? { ok: true, message: result.message } : { error: result.message };
}

export async function revealKeyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const key = await revealKey(str(form, "grantId"), user.id);
  return key ? { ok: true, secret: key } : { error: "Key not found." };
}

export async function buyerRevokeAction(form: FormData): Promise<void> {
  const user = await requireUser();
  await revokeGrant(str(form, "grantId"), user.id);
  revalidatePath("/dashboard");
}
