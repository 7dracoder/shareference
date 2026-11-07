import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { loginAction } from "@/app/actions/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-mono text-2xl">Log in</h1>
      <div className="card mt-6">
        <ActionForm action={loginAction} submitLabel="Log in" pendingLabel="Logging in…">
          <input type="hidden" name="next" value={next ?? ""} />
          <label className="block">
            <span className="label">Email</span>
            <input className="input" name="email" type="email" autoComplete="email" required />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input className="input" name="password" type="password" autoComplete="current-password" required />
          </label>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm text-mid">
        New here? <Link className="text-acid" href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
