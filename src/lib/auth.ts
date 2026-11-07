import "server-only";
import { cache } from "react";
import { auth, currentUser as clerkCurrentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { syncClerkUser, type User } from "./users";

export const currentUser = cache(async (): Promise<User | null> => {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return null;
  const { userId } = await auth();
  if (!userId) return null;
  const profile = await clerkCurrentUser();
  if (!profile) return null;
  const email = profile.emailAddresses.find((e) => e.id === profile.primaryEmailAddressId && e.verification?.status === "verified")?.emailAddress;
  return syncClerkUser({ id: userId, name: profile.fullName || profile.firstName || "Member", verifiedEmail: email });
});

export async function requireUser(next = "/dashboard"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.name === "Member") redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser("/ops");
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}
