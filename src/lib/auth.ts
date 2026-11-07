import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeEqual, sign } from "./crypto";
import { env } from "./env";
import { getUserById, type User } from "./users";

const COOKIE = "shr_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function startSession(userId: string): Promise<void> {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expires}`;
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  if (!safeEqual(sign(`${userId}.${expires}`), signature)) return null;
  if (Number(expires) < Date.now()) return null;
  return getUserById(userId);
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}
