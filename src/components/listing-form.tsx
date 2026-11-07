"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { ServiceMark, isFeaturedService, sortServicesForChooser } from "@/components/service-mark";
import type { ActionState } from "@/lib/form";

type Kind = "api_key" | "seat" | "compute";

interface ServiceOption {
  id: string;
  name: string;
  kinds: ReadonlyArray<Kind>;
  note: string;
  baseUrl?: string;
}

interface ComputerOption {
  id: string;
  label: string;
}

interface ListingFormProps {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  services: ServiceOption[];
  computers: ComputerOption[];
}

const KIND_LABEL: Record<Kind, string> = { api_key: "API credit", seat: "Team seat", compute: "My computer" };

const TITLE_PLACEHOLDER: Record<Kind, string> = {
  api_key: "Baseten credits I am not using",
  seat: "Cursor Teams seat, 2 hours",
  compute: "RTX 4090 with Llama 3.1 70B",
};

export function ListingForm({ action, services, computers }: ListingFormProps) {
  const [kind, setKind] = useState<Kind>("api_key");
  const options = useMemo(() => sortServicesForChooser(services.filter((s) => s.kinds.includes(kind))), [services, kind]);
  const [service, setService] = useState(options[0]?.id ?? "");
  const selected = services.find((s) => s.id === service) ?? options[0];
  const note = selected?.note;
  const featured = options.filter((s) => isFeaturedService(s.id));
  const rest = options.filter((s) => !isFeaturedService(s.id));

  function pickKind(next: Kind) {
    setKind(next);
    const nextOptions = sortServicesForChooser(services.filter((s) => s.kinds.includes(next)));
    setService(nextOptions[0]?.id ?? "");
  }

  return (
    <ActionForm action={action} submitLabel="Publish listing" pendingLabel="Publishing…">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap gap-2">
        {(["api_key", "seat", "compute"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "btn" : "btn-ghost"} onClick={() => pickKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {kind === "compute" ? (
        <>
          <p className="text-sm text-mid">
            Buyers rent time on the AI models running on your computer (Ollama or LM Studio). Their key stops working when the hours they paid for run out.
            Requests run on your machine, so you can see their prompts. The listing tells buyers this.
          </p>
          <input type="hidden" name="service" value="own-computer" />
          {computers.length === 0 ? (
            <p className="text-sm text-warn">Connect a computer above first.</p>
          ) : (
            <label className="block">
              <span className="label">Computer</span>
              <select className="input" name="nodeId">
                {computers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-low">
            Personal subscriptions like Claude Pro/Max or ChatGPT Plus can&apos;t be shared, since that means sharing your login.
            Share API credit or a team-plan seat instead.
          </p>
          <input type="hidden" name="service" value={selected?.id ?? ""} />
          <fieldset>
            <legend className="label">Service</legend>
            {featured.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-xs text-low">Ready to list</p>
                <div className="grid gap-2 sm:grid-cols-3">{featured.map((s) => <ServiceChoice key={s.id} service={s} selected={selected?.id === s.id} onSelect={setService} />)}</div>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((s) => <ServiceChoice key={s.id} service={s} selected={selected?.id === s.id} onSelect={setService} />)}
            </div>
            {note && <p className="mt-2 text-xs text-low">{note}</p>}
          </fieldset>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Title</span>
          <input className="input" name="title" required maxLength={100} placeholder={TITLE_PLACEHOLDER[kind]} />
        </label>
        <label className="block sm:col-span-2">
          <span className="label">What the buyer gets</span>
          <textarea className="input" name="description" rows={3} required maxLength={1000} />
        </label>
      </div>

      {kind === "api_key" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {!selected?.baseUrl && (
            <label className="block sm:col-span-2">
              <span className="label">Upstream base URL (OpenAI-compatible, https)</span>
              <input className="input font-mono" name="upstreamBaseUrl" type="url" required placeholder="https://llm.yourdomain.com/v1" />
            </label>
          )}
          <label className="block sm:col-span-2">
            <span className="label">API key (encrypted, never shown again)</span>
            <input className="input font-mono" name="credential" type="password" required autoComplete="off" />
          </label>
          <input type="hidden" name="features" value="chat" />
          <label className="block sm:col-span-2">
            <span className="label">Allowed models (comma separated, first is the default)</span>
            <input className="input font-mono" name="models" required placeholder={selected?.id === "xai" ? "grok-2, grok-2-mini" : selected?.id === "baseten" ? "your-model-id" : "llama-3.3-70b"} />
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
      )}

      {kind === "seat" && (
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

      {kind === "compute" && (
        <label className="block sm:w-1/2">
          <span className="label">Price per hour (USD)</span>
          <input className="input" name="hourlyPriceUsd" type="number" step="0.5" min={1} max={500} defaultValue={2} />
        </label>
      )}

      {kind !== "seat" && (
        <details>
          <summary className="text-sm text-mid">Limits per buyer: 60 requests a minute, 4,000 tokens a request</summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Requests per minute</span>
              <input className="input" name="maxRpm" type="number" min={1} max={600} defaultValue={60} />
            </label>
            <label className="block">
              <span className="label">Tokens per request</span>
              <input className="input" name="maxTokensPerRequest" type="number" min={16} max={128000} defaultValue={4000} />
            </label>
          </div>
        </details>
      )}
      <label className="flex items-start gap-3 text-sm text-mid">
        <input type="checkbox" name="authorizedSharing" required className="mt-1" />
        {kind === "compute"
          ? "This is my computer and I'm allowed to share it."
          : "I'm allowed to share this under the service's terms, and I'll handle seat invites and removal myself."}
      </label>
    </ActionForm>
  );
}

function ServiceChoice({
  service,
  selected,
  onSelect,
}: {
  service: ServiceOption;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(service.id)}
      className={`flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${selected ? "border-acid bg-acid/5" : "border-line bg-panel hover:border-low"}`}
    >
      <ServiceMark id={service.id} size={22} />
      <span className="font-medium leading-tight">{service.name}</span>
    </button>
  );
}
