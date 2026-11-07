import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { integrationStatus, env } from "@/lib/env";
import {
  pendingForPlatform,
  pendingProviderPayouts,
  providerPayoutDetails,
  revenueSummary,
  METHOD_LABEL,
} from "@/lib/payments";
import { recentAgentEvents } from "@/lib/agents/log";
import { ledgerInsights, memoryInsight } from "@/lib/agents/optimizer";
import { formatCents } from "@/lib/pricing";
import { aliasFrom, aliasMap } from "@/lib/users";
import { confirmFeeAction, markProviderPaidAction } from "@/app/actions/provider";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
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
  const [revenue, pendingDeposits, unpaid, events, insights] = await Promise.all([
    revenueSummary(),
    pendingForPlatform(),
    pendingProviderPayouts(),
    recentAgentEvents(40),
    ledgerInsights(),
  ]);
  const aliases = await aliasMap([
    ...pendingDeposits.map((p) => p.buyerId),
    ...unpaid.flatMap((p) => (p.providerId ? [p.providerId] : [])),
  ]);
  const payoutDetails = await Promise.all(unpaid.map(async (p) => [p.id, await providerPayoutDetails(p)] as const));
  const payoutById = new Map(payoutDetails);
  const integrations = integrationStatus();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        {env.DEMO_MODE && <p className="mt-2 text-sm text-warn">DEMO_MODE is on. Demo orders are excluded from revenue below.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross collected" value={formatCents(revenue.grossCents)} />
        <Stat label="Platform fee kept" value={formatCents(revenue.platformCents)} />
        <Stat label="Owed to providers" value={formatCents(revenue.providerCents)} />
        <Stat label="Buyers / orders" value={`${revenue.buyers} / ${revenue.orders}`} />
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">1 · Buyer deposits</h2>
        <p className="mt-1 text-sm text-mid">Confirm when the full Zelle amount lands in the platform account. That unlocks the buyer&apos;s access.</p>
        {pendingDeposits.length === 0 ? (
          <p className="mt-3 text-sm text-mid">Nothing waiting.{revenue.demoOrders > 0 && ` (${revenue.demoOrders} demo orders so far.)`}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {pendingDeposits.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="font-mono">{p.reference}</span>
                <span>{aliasFrom(aliases, p.buyerId)}</span>
                <span className="font-medium">{formatCents(p.grossCents)}</span>
                <span className="text-low">{p.status === "buyer_marked_sent" ? "Buyer says paid" : "Not marked yet"}</span>
                <form action={confirmFeeAction}>
                  <input type="hidden" name="paymentId" value={p.id} />
                  <button className="btn" type="submit">Deposit received</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">2 · Pay providers</h2>
        <p className="mt-1 text-sm text-mid">
          Send each provider their share from the platform account, then mark it paid.
          {revenue.unpaidProviders > 0 && ` ${revenue.unpaidProviders} waiting.`}
        </p>
        {unpaid.length === 0 ? (
          <p className="mt-3 text-sm text-mid">No provider payouts waiting.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {unpaid.map((p) => {
              const details = payoutById.get(p.id);
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0 space-y-1">
                    <p><span className="font-mono">{p.reference}</span> · {aliasFrom(aliases, p.providerId)}</p>
                    {details ? (
                      <p className="text-mid">
                        Send <span className="font-medium text-hi">{formatCents(details.cents)}</span> via {METHOD_LABEL[details.method]} to{" "}
                        <span className="select-all font-mono text-hi">{details.handle}</span>
                        {details.holderName ? ` (${details.holderName})` : ""}
                      </p>
                    ) : (
                      <p className="text-warn">Provider has no payout method on file.</p>
                    )}
                  </div>
                  <form action={markProviderPaidAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button className="btn" type="submit" disabled={!details}>Marked paid</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="text-lg font-semibold">Usage notes</h2>
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
          <h2 className="text-lg font-semibold">Integrations</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(integrations).map(([name, on]) => (
              <li key={name} className="flex justify-between gap-3">
                <span>{name}</span>
                <span className={on ? "text-acid" : "text-low"}>{on ? "connected" : "not configured"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">Agent activity</h2>
        <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-line py-2 last:border-0">
              <span className="font-mono text-xs text-low">{new Date(e.createdAt).toLocaleTimeString()}</span>
              <span className="text-low">{e.agent}</span>
              <span>{e.action} · {e.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
