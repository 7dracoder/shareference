import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { integrationStatus, env } from "@/lib/env";
import { pendingForPlatform, revenueSummary, METHOD_LABEL, type PayMethod } from "@/lib/payments";
import { recentAgentEvents } from "@/lib/agents/log";
import { ledgerInsights, memoryInsight } from "@/lib/agents/optimizer";
import { formatCents } from "@/lib/pricing";
import { aliasFrom, aliasMap } from "@/lib/users";
import { confirmFeeAction } from "@/app/actions/provider";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="mt-2 font-mono text-3xl">{value}</p>
    </div>
  );
}

async function MemoryPanel() {
  const text = await memoryInsight();
  return (
    <p className="whitespace-pre-line text-sm text-mid">
      {text ?? "cognee is not configured. Add COGNEE_BASE_URL and COGNEE_API_KEY to give the agents shared memory."}
    </p>
  );
}

export default async function OpsPage() {
  await requireAdmin();
  const [revenue, pending, events, insights] = await Promise.all([
    revenueSummary(),
    pendingForPlatform(),
    recentAgentEvents(40),
    ledgerInsights(),
  ]);
  const aliases = await aliasMap(pending.map((p) => p.buyerId));
  const integrations = integrationStatus();

  return (
    <div className="space-y-8">
      <div>
        <p className="kicker">Ops · agentic organization</p>
        <h1 className="mt-3 font-mono text-3xl">Live revenue and agent activity</h1>
        {env.DEMO_MODE && <p className="mt-2 text-sm text-warn">DEMO_MODE is on. Demo orders are excluded from revenue below.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Real money paid (gross)" value={formatCents(revenue.grossCents)} />
        <Stat label="Platform revenue" value={formatCents(revenue.platformCents)} />
        <Stat label="Paid directly to providers" value={formatCents(revenue.providerCents)} />
        <Stat label="Paying buyers / orders" value={`${revenue.buyers} / ${revenue.orders}`} />
      </div>

      <section className="card">
        <h2 className="kicker">Confirm money that reached your bank</h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-mid">Nothing waiting. ({revenue.demoOrders} demo orders so far.)</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="font-mono">{p.reference}</span>
                <span>{aliasFrom(aliases, p.buyerId)}</span>
                <span>{formatCents(p.feeCents)} via {METHOD_LABEL[p.method as PayMethod]}</span>
                <span className="text-low">{p.status === "buyer_marked_sent" ? "buyer says sent" : "not sent yet"}</span>
                <form action={confirmFeeAction}>
                  <input type="hidden" name="paymentId" value={p.id} />
                  <button className="btn" type="submit">Received</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="kicker">Optimizer agent</h2>
          {insights.length === 0 ? (
            <p className="mt-3 text-sm text-mid">No traffic yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {insights.map((i) => (
                <li key={i.title}>
                  <p className="text-sm font-medium">{i.title}</p>
                  <p className="text-sm text-mid">{i.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <h3 className="label mt-5">From shared memory (cognee)</h3>
          <Suspense fallback={<p className="text-sm text-low">Asking cognee…</p>}>
            <MemoryPanel />
          </Suspense>
        </section>

        <section className="card">
          <h2 className="kicker">Integrations</h2>
          <ul className="mt-3 space-y-2 font-mono text-sm">
            {Object.entries(integrations).map(([name, on]) => (
              <li key={name} className="flex justify-between">
                <span>{name}</span>
                <span className={on ? "text-acid" : "text-low"}>{on ? "connected" : "not configured"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 className="kicker">Agent activity</h2>
        <ul className="mt-3 divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[160px_120px_1fr]">
              <span className="font-mono text-xs text-low">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="font-mono text-xs text-acid">{e.agent}</span>
              <span className="text-mid"><span className="text-hi">{e.action}</span> · {e.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
