import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { safePath } from "@/lib/redirect";
import { ActionForm } from "@/components/action-form";
import { saveNameAction } from "@/app/actions/profile";
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destination = safePath(next);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(destination)}`);
  if (user.name !== "Member") redirect(destination);
  return <div className="card mx-auto max-w-md space-y-5"><h1 className="text-2xl font-semibold">What should we call you?</h1><p className="text-sm text-mid">Just your name to finish setting up. Other users see your public alias.</p><ActionForm action={saveNameAction} submitLabel="Continue"><input type="hidden" name="next" value={destination} /><label className="block"><span className="label">Your name</span><input className="input" name="name" required maxLength={80} autoComplete="given-name" autoFocus /></label></ActionForm></div>;
}
