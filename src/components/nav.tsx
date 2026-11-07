import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

export async function Nav() {
  const user = await currentUser();
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          switch<span className="text-acid">board</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-mid">
          <Link href="/marketplace" className="hover:text-hi">Marketplace</Link>
          <Link href="/verify" className="hover:text-hi">Verify</Link>
          {user ? (
            <>
              <Link href="/dashboard" className="hover:text-hi">My access</Link>
              <Link href="/provider" className="hover:text-hi">Sell</Link>
              {user.isAdmin && <Link href="/ops" className="text-acid hover:brightness-110">Ops</Link>}
              <span className="pill" title="Your public alias. Others never see your name or email.">{user.alias}</span>
              <form action={logoutAction}>
                <button className="hover:text-hi" type="submit">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-hi">Log in</Link>
              <Link href="/signup" className="btn">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
