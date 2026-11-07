"use client";
import { useActionState } from "react";
import { tryAccessAction } from "@/app/actions/playground";
import type { ActionState } from "@/lib/form";
export interface AccessOption { id: string; title: string; }
export function Playground({ options, initialGrantId }: { options: AccessOption[]; initialGrantId?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(tryAccessAction, {});
  return <div className="grid gap-5 lg:grid-cols-2"><form action={action} className="card space-y-5" aria-busy={pending}>
    <label className="block"><span className="label">Your access</span><select className="input" name="grantId" defaultValue={initialGrantId || options[0]?.id}>{options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
    <label className="block"><span className="label">Message</span><textarea className="input" name="prompt" rows={6} required maxLength={20_000} placeholder="What would you like help with?" /></label>
    <p className="text-xs text-low">Uses your prepaid credit and the limits on this access.</p><button className="btn" disabled={pending} type="submit">{pending ? "Thinking…" : "Send message"}</button>
  </form><section className="card" aria-label="Model response"><h2 className="font-medium">Response</h2><div className="mt-4 text-sm leading-relaxed" aria-live="polite">{pending ? <p className="text-mid">Waiting for your model…</p> : state.error ? <p role="alert" className="text-bad">{state.error}</p> : state.message ? <p className="whitespace-pre-wrap">{state.message}</p> : <p className="text-low">Your response will appear here.</p>}</div></section></div>;
}
