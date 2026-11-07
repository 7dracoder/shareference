"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/form";

interface RevealKeyProps {
  grantId: string;
  keyPrefix: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}

export function RevealKey({ grantId, keyPrefix, action }: RevealKeyProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  if (state.secret) {
    const secret = state.secret;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <code className="code flex-1 select-all">{secret}</code>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            navigator.clipboard.writeText(secret).then(() => setCopied(true)).catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="grantId" value={grantId} />
      <code className="font-mono text-sm text-mid">{keyPrefix}••••••••••••</code>
      <button className="btn-ghost" type="submit" disabled={pending}>{pending ? "…" : "Reveal key"}</button>
      {state.error && <span className="text-sm text-bad">{state.error}</span>}
    </form>
  );
}
