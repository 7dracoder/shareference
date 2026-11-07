"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
export function RefreshStatus() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const interval = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000);
    return () => clearInterval(interval);
  }, [router]);
  return <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-mid"><span role="status">Waiting for payment confirmation</span><button type="button" className="btn-ghost" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Checking…" : "Check status"}</button></div>;
}
