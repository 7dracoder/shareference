import { safePath } from "@/lib/redirect";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safePath(next);
  return <div className="mx-auto max-w-md space-y-5">
    <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
    <p className="text-sm text-mid">One account for buying and sharing. Other people see an alias, not your name.</p>
    {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
      ? <SignUp path="/signup" routing="path" fallbackRedirectUrl={`/onboarding?next=${encodeURIComponent(destination)}`} signInUrl={`/login?next=${encodeURIComponent(destination)}`} />
      : <div className="card space-y-3"><h2 className="font-medium">Sign-in is being connected</h2><p className="text-sm text-mid">You can browse listings now. Account creation will be available once setup is complete.</p><Link href="/marketplace" className="btn">Browse listings</Link></div>}
  </div>;
}
