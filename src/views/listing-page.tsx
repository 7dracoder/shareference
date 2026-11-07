import Link from "next/link";
import { notFound } from "next/navigation";
import { getListing } from "@/lib/listings";
import { currentUser } from "@/lib/auth";
import { availableMethods, METHOD_LABEL } from "@/lib/payments";
import { getNode, specLines } from "@/lib/nodes";
import { tierEnabled } from "@/lib/agents/router";
import { env } from "@/lib/env";
import { formatCents, formatUsd, TIER_INFO, TIERS } from "@/lib/pricing";
import { CheckoutForm } from "@/components/checkout-form";
import { ServiceMark } from "@/components/service-mark";
import { serviceName } from "@/lib/services";
import { buyAction } from "@/app/actions/buyer";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing || listing.status !== "active") notFound();
  const [user, methods, node] = await Promise.all([
    currentUser(),
    availableMethods(listing),
    listing.kind === "compute" && listing.nodeId ? getNode(listing.nodeId) : null,
  ]);
  const isOwn = user?.id === listing.providerId;
  const offline = listing.kind === "compute" && !node?.online;
  const maxHours = Math.max(1, Math.floor(50_000 / Math.max(1, listing.seatPriceCents)));
  const markId = listing.kind === "pool" ? "openai-compatible" : listing.service;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <Link href="/marketplace" className="text-sm text-mid hover:text-hi">← All listings</Link>
        <div className="mt-4 flex items-start gap-3">
          <ServiceMark id={markId} size={36} />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{listing.title}</h1>
            <p className="mt-2 text-sm text-low">{serviceName(listing.service)} · listed by {listing.providerAlias}</p>
          </div>
        </div>
        <p className="mt-5 whitespace-pre-line text-mid">{listing.description}</p>


        <div className="card mt-6 space-y-2 text-sm">
          <h2 className="font-semibold">What you get</h2>
          {listing.kind === "pool" && (
            <ul className="space-y-2 text-mid">
              {TIERS.filter(tierEnabled).map((t) => (
                <li key={t}>
                  <span className="text-hi">{TIER_INFO[t].label}</span> via {TIER_INFO[t].backend}: {formatUsd(TIER_INFO[t].pricePer1kMicros)} per 1K tokens
                </li>
              ))}
              <li>Endpoints: chat completions, embeddings, rerank</li>
            </ul>
          )}
          {listing.kind === "api_key" && (
            <ul className="space-y-1 text-mid">
              <li>Models: {listing.models.length ? listing.models.join(", ") : "any the owner's key supports"}</li>
              <li>{formatUsd(listing.pricePer1kMicros)} per 1K tokens, taken from your prepaid credit</li>
            </ul>
          )}
          {listing.kind === "seat" && (
            <p className="text-mid">
              {listing.seatMinutes} minutes on a {listing.service} team-plan seat. After you pay, the owner adds you to their team in the vendor&apos;s
              admin console. The timer starts then, and you&apos;re removed when it ends.
            </p>
          )}
          {listing.kind === "compute" && (
            <div className="space-y-3 text-mid">
              <p className={node?.online ? "text-acid" : "text-warn"}>{node?.online ? "Online now" : "Offline right now"}</p>
              {node && specLines(node.specs).length > 0 && (
                <ul className="space-y-1">{specLines(node.specs).map((line) => <li key={line}>{line}</li>)}</ul>
              )}
              <p>Models: {node?.models.length ? node.models.join(", ") : "none available right now"}</p>
              <p>{formatCents(listing.seatPriceCents)} per hour. Your key works with any of these models until your hours run out.</p>
              <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-hi">
                Your requests run on this person&apos;s computer, so they can see your prompts and the replies. Don&apos;t send anything private.
              </p>
            </div>
          )}
          <p className="pt-2 text-low">
            Limits: {listing.maxRpm} requests a minute, {listing.maxTokensPerRequest.toLocaleString()} tokens a request. The owner can lower these or end access at any time.
          </p>
        </div>
      </section>

      <aside className="card h-fit">
        <h2 className="font-semibold">Buy</h2>
        {!user ? (
          <p className="mt-4 text-sm text-mid">
            <Link className="text-acid underline" href={`/signup?next=/marketplace/${listing.id}`}>Sign up</Link> or{" "}
            <Link className="text-acid underline" href={`/login?next=/marketplace/${listing.id}`}>log in</Link> to buy.
          </p>
        ) : isOwn ? (
          <p className="mt-4 text-sm text-mid">This is your listing.</p>
        ) : offline ? (
          <p className="mt-4 text-sm text-mid">This computer is offline, so you can&apos;t buy time on it right now. Check back later.</p>
        ) : methods.length === 0 && !env.DEMO_MODE ? (
          <p className="mt-4 text-sm text-mid">The owner hasn&apos;t set up a payment method yet.</p>
        ) : (
          <div className="mt-4">
            <CheckoutForm action={buyAction}>
              <input type="hidden" name="listingId" value={listing.id} />
              {listing.kind === "seat" && <p className="text-2xl font-semibold">{formatCents(listing.seatPriceCents)}</p>}
              {listing.kind === "compute" && (
                <label className="block">
                  <span className="label">Hours ({formatCents(listing.seatPriceCents)} each)</span>
                  <input className="input" name="hours" type="number" step="1" min={1} max={maxHours} defaultValue={1} />
                  <span className="mt-1 block text-xs text-low">The clock starts when your payment is confirmed.</span>
                </label>
              )}
              {(listing.kind === "pool" || listing.kind === "api_key") && (
                <label className="block">
                  <span className="label">Credit amount (USD)</span>
                  <input className="input" name="amountUsd" type="number" step="1" min={listing.minPurchaseCents / 100} max={500} defaultValue={Math.max(5, listing.minPurchaseCents / 100)} />
                </label>
              )}
              {listing.kind === "seat" && <label className="block"><span className="label">Email for your seat invitation</span><input name="deliveryEmail" className="input" type="email" required maxLength={254} /><span className="mt-1 block text-xs text-low">Only this provider sees it, so they can invite you.</span></label>}
              <label className="block">
                <span className="label">Pay with</span>
                <select className="input" name="method" defaultValue={methods[0] ?? "demo"}>
                  {methods.map((m) => (
                    <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                  ))}
                  {env.DEMO_MODE && <option value="demo">Demo payment (no money moves)</option>}
                </select>
              </label>
              <p className="text-xs text-mid">
                {(listing.kind === "pool" || listing.kind === "api_key") && "Credit expires 30 days after activation. "}
                You&apos;ll get a Zelle QR for the full amount. Access unlocks after the provider confirms they got paid.
              </p>
            </CheckoutForm>
          </div>
        )}
      </aside>
    </div>
  );
}
