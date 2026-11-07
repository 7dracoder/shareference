"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="card mx-auto max-w-lg space-y-4"><h1 className="text-2xl font-semibold">We couldn’t load this page.</h1><p className="text-sm text-mid">Please try again in a moment. If you just submitted a payment, check your order before sending it again.</p><div className="flex gap-3"><button className="btn" onClick={reset}>Try again</button><Link className="btn-ghost" href="/">Go home</Link></div></div>;
}
