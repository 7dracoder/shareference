import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@/lib/auth";

export async function Nav() {
  const user = await currentUser();
  return <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
    <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <Link href="/" className="text-lg font-semibold tracking-tight">share<span className="text-acid">ference</span><span className="text-acid" aria-hidden> ·</span></Link>
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-mid">
        <Link href="/marketplace" className="hover:text-hi">Get access</Link>
        <Link href="/provider" className="hover:text-hi">Provide access</Link>
        {user ? <><Link href="/dashboard" className="hover:text-hi">My access</Link>{user.isAdmin && <Link href="/ops" className="hover:text-hi">Admin</Link>}<UserButton /></> : <Link href="/login" className="btn-ghost">Sign in</Link>}
      </nav>
    </div>
  </header>;
}
