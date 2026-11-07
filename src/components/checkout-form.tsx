import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { ActionForm } from "./action-form";
import type { ActionState } from "@/lib/form";

export function CheckoutForm({ action, children }: { action: (state: ActionState, form: FormData) => Promise<ActionState>; children: ReactNode }) {
  return <ActionForm action={action} submitLabel="Review payment instructions">
    <input type="hidden" name="checkoutKey" value={randomUUID()} />{children}
  </ActionForm>;
}
