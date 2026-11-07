import Link from "next/link";
import { notFound } from "next/navigation";
import { getListing } from "@/lib/listings";
import { currentUser } from "@/lib/auth";
import { availableMethods, METHOD_LABEL } from "@/lib/payments";
import { env } from "@/lib/env";
import { feePercent, formatCents, formatUsd, TIER_INFO, TIERS } from "@/lib/pricing";
import { ActionForm } from "@/components/action-form";
import { buyAction } from "@/app/actions/buyer";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  if (!listing || listing.status !== "active") notFound();
  const user = await currentUser();
  const methods = availableMethods(listing);
  const isOwn = user?.id === listing.providerId;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <Link href="/marketplace" className="text-sm text-mid hover:text-hi">← Marketplace</Link>
        <h1 className="mt-4 font-mono text-3xl">{listing.title}</h1>
        <p className="mt-2 font-mono text-xs text-low">offered by {listing.providerAlias}</p>
        <p className="mt-5 whitespace-pre-line text-mid">{listing.description}</p>

        <div className="card mt-6 space-y-2 text-sm">
          <h2 className="kicker">What you get</h2>
          {listing.kind === "pool" && (
            <ul className="space-y-2 text-mid">
              {TIERS.map((t) => (
                <li key={t}>
                  <span className="text-hi">{TIER_INFO[t].label}</span> via {TIER_INFO[t].backend}: {formatUsd(TIER_INFO[t].pricePer1kMicros)} / 1K tokens
                </li>
              ))}
              <li>Endpoints: chat completions, embeddings, rerank</li>
            </ul>
          )}
          {listing.kind === "api_key" && (
            <ul className="space-y-1 text-mid">
              <li>Features: {listing.features.join(", ")}</li>
              <li>Models: {listing.models.length ? listing.models.join(", ") : "any the owner's key supports"}</li>
              <li>Price: {formatUsd(listing.pricePer1kMicros)} / 1K tokens, debited from your prepaid credit</li>
            </ul>
          )}
          {listing.kind === "seat" && (
            <p className="text-mid">
              {listing.seatMinutes} minutes on a {listing.service} team-plan seat. After payment, the owner assigns you a seat in the vendor&apos;s
              admin console; the timer starts then, and the seat is reclaimed when it ends.
            </p>
          )}
          <p className="pt-2 text-low">
            Limits: {listing.maxRpm} requests/min, {listing.maxTokensPerRequest} tokens/request. The owner can tighten these or revoke at any time.
          </p>
        </div>
      </section>

      <aside className="card h-fit">
        <h2 className="kicker">Buy</h2>
        {!user ? (
          <p className="mt-4 text-sm text-mid">
            <Link className="text-acid" href={`/login?next=/marketplace/${listing.id}`}>Log in</Link> to buy.
          </p>
        ) : isOwn ? (
          <p className="mt-4 text-sm text-mid">This is your listing.</p>
        ) : methods.length === 0 && !env.DEMO_MODE ? (
          <p className="mt-4 text-sm text-mid">No payment method is set up for this listing yet.</p>
        ) : (
          <div className="mt-4">
            <ActionForm action={buyAction} submitLabel="Continue to payment">
              <input type="hidden" name="listingId" value={listing.id} />
              {listing.kind === "seat" ? (
                <p className="font-mono text-2xl">{formatCents(listing.seatPriceCents)}</p>
              ) : (
                <label className="block">
                  <span className="label">Credit amount (USD)</span>
                  <input className="input" name="amountUsd" type="number" step="1" min={listing.minPurchaseCents / 100} max={500} defaultValue={Math.max(5, listing.minPurchaseCents / 100)} />
                </label>
              )}
              <label className="block">
                <span className="label">Pay with</span>
                <select className="input" name="method" defaultValue={methods[0] ?? "demo"}>
                  {methods.map((m) => (
                    <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                  ))}
                  {env.DEMO_MODE && <option value="demo">Demo payment (no money moves)</option>}
                </select>
              </label>
              <p className="text-xs text-low">
                {listing.providerId
                  ? `You pay the provider directly. ${feePercent()} goes directly to the Switchboard platform. Nobody in between holds your money.`
                  : "You pay Switchboard directly for pool credit."}
              </p>
            </ActionForm>
          </div>
        )}
      </aside>
    </div>
  );
}
