"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { authenticate, createUser } from "@/lib/users";
import { allow, str, type ActionState } from "@/lib/form";

const AUTH_WINDOW_MS = 10 * 60_000;
const AUTH_MAX = 10;

const signupSchema = z.object({
  email: z.string().email("Enter a valid email").max(200),
  name: z.string().min(1, "Enter your name").max(80),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function signupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!allow(`signup:${await clientKey()}`, AUTH_MAX, AUTH_WINDOW_MS)) return { error: "Too many attempts. Try again later." };
  const parsed = signupSchema.safeParse({ email: str(form, "email"), name: str(form, "name"), password: str(form, "password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  let userId: string;
  try {
    userId = createUser(parsed.data.email, parsed.data.name, parsed.data.password).id;
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Could not create account" };
  }
  await startSession(userId);
  redirect("/dashboard");
}

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!allow(`login:${await clientKey()}`, AUTH_MAX, AUTH_WINDOW_MS)) return { error: "Too many attempts. Try again later." };
  const user = authenticate(str(form, "email"), str(form, "password"));
  if (!user) return { error: "Wrong email or password." };
  await startSession(user.id);
  const next = str(form, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
