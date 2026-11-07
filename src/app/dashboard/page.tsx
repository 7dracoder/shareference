import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { grantsForBuyer, usageSummary, type Grant } from "@/lib/grants";
import { getListing } from "@/lib/listings";
import { paymentsForBuyer } from "@/lib/payments";
import { env } from "@/lib/env";
import { formatCents, formatUsd } from "@/lib/pricing";
import { aliasOf } from "@/lib/users";
import { RevealKey } from "@/components/reveal-key";
import { LimitsForm } from "@/components/limits-form";
import { revealKeyAction, buyerRevokeAction } from "@/app/actions/buyer";

const STATUS_STYLE: Record<Grant["status"], string> = {
  active: "text-acid",
  pending_assignment: "text-warn",
  exhausted: "text-warn",
  expired: "text-low",
  revoked: "text-bad",
};

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-line">
        <div className="h-full bg-acid" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 font-mono text-xs text-mid">
        {formatUsd(spent)} of {formatUsd(budget)} used
      </p>
    </div>
  );
}

function GrantCard({ grant }: { grant: Grant }) {
  const listing = getListing(grant.listingId);
  const usage = usageSummary(grant.id);
  const isPool = listing?.kind === "pool";
  const isSeat = listing?.kind === "seat";
  return (
    <article className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{listing?.title ?? "Listing removed"}</h2>
          <p className="font-mono text-xs text-low">from {aliasOf(grant.providerId)}</p>
        </div>
        <span className={`font-mono text-xs uppercase ${STATUS_STYLE[grant.status]}`}>{grant.status.replace("_", " ")}</span>
      </div>

      {isSeat ? (
        <p className="text-sm text-mid">
          {grant.status === "pending_assignment"
            ? "Waiting for the owner to assign your seat in the vendor's admin console. You'll get access in the vendor's app under your own login."
            : grant.expiresAt
              ? `Seat active until ${new Date(grant.expiresAt).toLocaleString()}.`
              : "Seat active."}
        </p>
      ) : (
        <>
          <BudgetBar spent={grant.spentMicros} budget={grant.budgetMicros} />
          {grant.keyPrefix && <RevealKey grantId={grant.id} keyPrefix={grant.keyPrefix} action={revealKeyAction} />}
          <p className="font-mono text-xs text-mid">
            {usage.requests} requests · {usage.tokens.toLocaleString()} tokens · {usage.blocked} blocked
            {usage.byBackend.length > 0 && ` · ${usage.byBackend.map((b) => `${b.backend}: ${b.requests}`).join(", ")}`}
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-mid hover:text-hi">How to call it</summary>
            <pre className="code mt-2">{`from openai import OpenAI
client = OpenAI(base_url="${env.APP_URL}/api/v1", api_key="sb_...")
client.chat.completions.create(
    model="${isPool ? "switchboard-private" : (grant.models[0] ?? "model-id")}",
    messages=[{"role": "user", "content": "hello"}],
)`}</pre>
          </details>
          {isPool && grant.status === "active" && (
            <details>
              <summary className="cursor-pointer text-sm text-mid hover:text-hi">Limits for this key</summary>
              <div className="mt-3">
                <LimitsForm
                  grantId={grant.id}
                  maxRpm={grant.maxRpm}
                  maxTokensPerRequest={grant.maxTokensPerRequest}
                  privacyFloor={grant.privacyFloor}
                  expiresAt={grant.expiresAt}
                  showPrivacy
                />
              </div>
            </details>
          )}
        </>
      )}

      {(grant.status === "active" || grant.status === "pending_assignment") && (
        <form action={buyerRevokeAction}>
          <input type="hidden" name="grantId" value={grant.id} />
          <button className="btn-danger" type="submit">End access</button>
        </form>
      )}
    </article>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const grants = grantsForBuyer(user.id);
  const openOrders = paymentsForBuyer(user.id).filter((p) => p.status === "awaiting_payment" || p.status === "buyer_marked_sent");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">My access</p>
          <h1 className="mt-3 font-mono text-3xl">Keys and seats you bought</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/playground" className="btn-ghost">Playground</Link>
          <Link href="/marketplace" className="btn">Buy access</Link>
        </div>
      </div>

      {openOrders.length > 0 && (
        <section className="card">
          <h2 className="kicker">Orders waiting on payment</h2>
          <ul className="mt-3 divide-y divide-line">
            {openOrders.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono">{p.reference}</span>
                <span>{formatCents(p.grossCents)}</span>
                <Link href={`/orders/${p.id}`} className="text-acid">Open</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grants.length === 0 ? (
        <div className="card text-mid">
          No access yet. Start with the <Link className="text-acid" href="/marketplace">private inference pool</Link>.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grants.map((g) => (
            <GrantCard key={g.id} grant={g} />
          ))}
        </div>
      )}
    </div>
  );
}
