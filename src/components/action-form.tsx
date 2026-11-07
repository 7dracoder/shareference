"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/lib/form";

interface ActionFormProps {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  submitDisabled?: boolean;
}

/** Form wired to a server action, showing pending state and the result message. */
export function ActionForm({ action, children, submitLabel, pendingLabel, className, submitDisabled }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form aria-busy={pending} action={formAction} className={className ?? "space-y-4"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" type="submit" disabled={pending || submitDisabled}>
          {pending ? (pendingLabel ?? "Working…") : submitLabel}
        </button>
        {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
        {state.ok && state.message && <p role="status" className="text-sm text-acid">{state.message}</p>}
      </div>
    </form>
  );
}
