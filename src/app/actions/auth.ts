"use server";
import { clerkClient, auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
export async function logoutAction(): Promise<void> {
  const { sessionId } = await auth();
  if (sessionId) await (await clerkClient()).sessions.revokeSession(sessionId);
  redirect("/");
}
