"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import type { ActionState } from "@/lib/form";

interface ServiceOption {
  id: string;
  name: string;
  kinds: ReadonlyArray<"api_key" | "seat">;
  note: string;
  baseUrl?: string;
}

interface ListingFormProps {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  services: ServiceOption[];
}

export function ListingForm({ action, services }: ListingFormProps) {
  const [kind, setKind] = useState<"api_key" | "seat">("api_key");
  const options = services.filter((s) => s.kinds.includes(kind));
  const [service, setService] = useState(options[0]?.id ?? "");
  const selected = services.find((s) => s.id === service);
  const note = selected?.note;

  return (
    <ActionForm action={action} submitLabel="Publish listing" pendingLabel="Checking policy…">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-2">
        {(["api_key", "seat"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className={kind === k ? "btn" : "btn-ghost"}
            onClick={() => {
              setKind(k);
              setService(services.find((s) => s.kinds.includes(k))?.id ?? "");
            }}
          >
            {k === "api_key" ? "Share an API / credits" : "Lend a team seat"}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="label">Service</span>
        <select className="input" name="service" value={service} onChange={(e) => setService(e.target.value)}>
          {options.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {note && <span className="mt-1 block text-xs text-low">Policy: {note}</span>}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Title</span>
          <input className="input" name="title" required maxLength={100} placeholder={kind === "seat" ? "Canva Teams seat, 2 hours" : "Llama 70B on my team's credits"} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">What the buyer gets</span>
          <textarea className="input" name="description" rows={3} required maxLength={1000} />
        </label>
      </div>

      {kind === "api_key" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {selected?.baseUrl ? (
            <input type="hidden" name="upstreamBaseUrl" value={selected.baseUrl} />
          ) : (
            <label className="block sm:col-span-2">
              <span className="label">Upstream base URL (OpenAI-compatible, https)</span>
              <input className="input font-mono" name="upstreamBaseUrl" type="url" required placeholder="https://api.openai.com/v1" />
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="label">API key (sealed in the vault, never shown again)</span>
            <input className="input font-mono" name="credential" type="password" required autoComplete="off" />
          </label>
          <fieldset className="sm:col-span-2">
            <span className="label">Features buyers may use</span>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="features" value="chat" defaultChecked /> Chat</label>
            </div>
          </fieldset>
          <label className="block sm:col-span-2">
            <span className="label">Allowed models (comma separated; first is default)</span>
            <input className="input font-mono" name="models" required placeholder="llama-3.3-70b, qwen-2.5-32b" />
          </label>
          <label className="block">
            <span className="label">Price per 1K tokens (USD)</span>
            <input className="input" name="pricePer1kUsd" type="number" step="0.000001" min={0.000001} max={1} defaultValue={0.0005} />
          </label>
          <label className="block">
            <span className="label">Minimum purchase (USD)</span>
            <input className="input" name="minPurchaseUsd" type="number" step="1" min={1} max={500} defaultValue={5} />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Price (USD)</span>
            <input className="input" name="seatPriceUsd" type="number" step="0.5" min={1} max={500} defaultValue={5} />
          </label>
          <label className="block">
            <span className="label">Duration (minutes)</span>
            <input className="input" name="seatMinutes" type="number" step="15" min={15} defaultValue={120} />
          </label>
          <input type="hidden" name="minPurchaseUsd" value="1" />
        </div>
      )}

      <details><summary className="text-sm text-mid">Advanced limits · 60 requests/min, 4,000 tokens/request</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Default limit: requests / min</span>
          <input className="input" name="maxRpm" type="number" min={1} max={600} defaultValue={60} />
        </label>
        <label className="block">
          <span className="label">Default limit: tokens / request</span>
          <input className="input" name="maxTokensPerRequest" type="number" min={16} max={128000} defaultValue={4000} />
        </label>
      </div></details>
      <label className="flex items-start gap-3 text-sm text-mid"><input type="checkbox" name="authorizedSharing" required className="mt-1" />I’m authorized to provide this access under the service’s terms. I’ll manage any team-seat invitations and removal.</label>
    </ActionForm>
  );
}
