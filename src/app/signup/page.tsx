import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { signupAction } from "@/app/actions/auth";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="font-mono text-2xl">Create an account</h1>
      <p className="mt-2 text-sm text-mid">
        You get a random public alias. Other users only ever see the alias, never your name or email.
      </p>
      <div className="card mt-6">
        <ActionForm action={signupAction} submitLabel="Create account" pendingLabel="Creating…">
          <label className="block">
            <span className="label">Name</span>
            <input className="input" name="name" autoComplete="name" required maxLength={80} />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input className="input" name="email" type="email" autoComplete="email" required />
          </label>
          <label className="block">
            <span className="label">Password (10+ characters)</span>
            <input className="input" name="password" type="password" autoComplete="new-password" minLength={10} required />
          </label>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm text-mid">
        Already have one? <Link className="text-acid" href="/login">Log in</Link>
      </p>
    </div>
  );
}
