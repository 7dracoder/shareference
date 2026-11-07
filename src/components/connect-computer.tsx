"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/form";

interface ConnectComputerProps {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  /** Set to issue a new command for an existing computer (the old one stops working). */
  nodeId?: string;
  label: string;
}

export function ConnectComputer({ action, nodeId, label }: ConnectComputerProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  if (state.secret) {
    const command = state.secret;
    return (
      <div className="space-y-2">
        <p className="text-sm text-mid">Run this in a terminal on the computer you want to share. It needs Node.js 18 or newer, plus Ollama or LM Studio with at least one model. On Windows, use Command Prompt.</p>
        <div className="flex flex-wrap items-start gap-2">
          <code className="code flex-1 select-all">{command}</code>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(() => setCopied(false));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-xs text-low">The command contains a secret token, so don&apos;t share it. This page shows it only once. Once the terminal says it&apos;s sharing, reload this page to list the computer. Leave the terminal open while you want to be available.</p>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      {nodeId && <input type="hidden" name="nodeId" value={nodeId} />}
      <button className={nodeId ? "btn-ghost" : "btn"} type="submit" disabled={pending}>{pending ? "Working…" : label}</button>
      {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
    </form>
  );
}
