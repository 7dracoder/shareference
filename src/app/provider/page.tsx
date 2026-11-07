import { requireUser } from "@/lib/auth";
import { listingsByProvider, getListing } from "@/lib/listings";
import { grantsForProvider, usageSummary } from "@/lib/grants";
import { acceptedMethods, canReceivePayments, pendingForProvider, METHOD_LABEL, type PayMethod } from "@/lib/payments";
import { SERVICE_POLICIES } from "@/lib/policy";
import { feePercent, formatCents, formatUsd } from "@/lib/pricing";
import { aliasFrom, aliasMap } from "@/lib/users";
import { ActionForm } from "@/components/action-form";
import { ListingForm } from "@/components/listing-form";
import { LimitsForm } from "@/components/limits-form";
import {
  assignSeatAction,
  confirmReceiptAction,
  createListingAction,
  revokeAction,
  savePayoutAction,
  toggleListingAction,
} from "@/app/actions/provider";

export default async function ProviderPage() {
  const user = await requireUser("/provider");
  const [listings, allGrants, pending] = await Promise.all([
    listingsByProvider(user.id),
    grantsForProvider(user.id),
    pendingForProvider(user.id),
  ]);
  const grants = allGrants.filter((g) => g.status === "active" || g.status === "pending_assignment");
  const [details, aliases] = await Promise.all([
    Promise.all(grants.map(async (g) => ({ grant: g, listing: await getListing(g.listingId), usage: await usageSummary(g.id) }))),
    aliasMap([...grants.map((g) => g.buyerId), ...pending.map((p) => p.buyerId)]),
  ]);
  const pm = user.payoutMethods;
  const accepted = acceptedMethods();
  const ready = canReceivePayments(pm);
  const services = SERVICE_POLICIES.filter((s) => s.rule !== "forbidden").map((s) => ({ id: s.id, name: s.name, kinds: s.kinds, note: s.note, baseUrl: s.baseUrl }));

  return (
    <div className="space-y-8">
      <div>
        <p className="kicker">Provider workspace</p>
        <h1 className="mt-3 font-mono text-3xl">Your access. Your terms.</h1>
        <p className="mt-3 max-w-2xl text-mid">
          Buyers pay you directly. Shareference takes {feePercent()}, which buyers also send directly. Your credentials stay sealed; buyers see only your alias{" "}
          <span className="pill">{user.alias}</span>.
        </p>
      </div>

      <details className="card" open={!ready}>
        <summary className="font-medium">{ready ? "Payment details · ready" : "1 · Add payment details"}</summary>
        {accepted.length === 0 ? (
          <p className="mt-2 text-sm text-mid">Payments aren&apos;t open yet. The platform owner still needs to add a payout method.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-mid">Add at least one. Buyers can pay with {accepted.map((m) => METHOD_LABEL[m]).join(", ")}. Shown only to a buyer on their own order page.</p>
            <div className="mt-4">
              <ActionForm action={savePayoutAction} submitLabel="Save payout details">
                <div className="grid gap-3 sm:grid-cols-2">
                  {accepted.includes("zelle") && <>
                    <label className="block"><span className="label">Zelle email or phone</span><input className="input" name="zelle" defaultValue={pm.zelle} /></label>
                    <label className="block"><span className="label">Display name for Zelle</span><input className="input" name="zelleName" defaultValue={pm.zelleName} /></label>
                  </>}
                  {accepted.includes("venmo") && <label className="block"><span className="label">Venmo @handle</span><input className="input" name="venmo" defaultValue={pm.venmo} /></label>}
                  {accepted.includes("cashapp") && <label className="block"><span className="label">Cash App $cashtag</span><input className="input" name="cashapp" defaultValue={pm.cashapp} /></label>}
                  {accepted.includes("paypal") && <label className="block"><span className="label">PayPal email</span><input className="input" name="paypal" defaultValue={pm.paypal} /></label>}
                  {accepted.includes("usdc") && <label className="block"><span className="label">USDC address on Base</span><input className="input font-mono" name="usdc" placeholder="0x…" defaultValue={pm.usdc} /></label>}
                </div>
              </ActionForm>
            </div>
          </>
        )}
      </details>

      {pending.length > 0 && (
        <section className="card">
          <h2 className="kicker">Confirm payments you received</h2>
          <p className="mt-2 text-sm text-mid">Check your app for the reference code in the memo, then confirm. The buyer gets access once you and the platform both confirm.</p>
          <ul className="mt-3 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="font-mono">{p.reference}</span>
                <span>{aliasFrom(aliases, p.buyerId)}</span>
                <span>{formatCents(p.providerCents)} via {METHOD_LABEL[p.method as PayMethod]}</span>
                <span className="text-low">{p.status === "buyer_marked_sent" ? "buyer says sent" : "not sent yet"}</span>
                <form action={confirmReceiptAction}>
                  <input type="hidden" name="paymentId" value={p.id} />
                  <button className="btn" type="submit">I received it</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="kicker">People using your access</h2>
        {details.length === 0 ? (
          <p className="mt-3 text-sm text-mid">No active access yet. New buyers will appear here.</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {details.map(({ grant: g, listing, usage }) => (
              <article key={g.id} className="card space-y-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{listing?.title}</h3>
                    <p className="font-mono text-xs text-low">buyer: {aliasFrom(aliases, g.buyerId)}</p>
                  </div>
                  <span className="font-mono text-xs uppercase text-mid">{g.status.replace("_", " ")}</span>
                </div>
                {listing?.kind === "seat" ? (
                  g.status === "pending_assignment" ? (
                    <form action={assignSeatAction} className="space-y-2">
                      <p className="text-sm text-mid">Assign a {listing.service} seat to the buyer in the vendor&apos;s admin console, then start the timer.</p>
                      <p className="text-sm">Invite <span className="select-all font-mono">{g.deliveryEmail ?? "Contact the buyer through the payment app"}</span></p>
                      <input type="hidden" name="grantId" value={g.id} />
                      <button className="btn" type="submit">Seat assigned, start {listing.seatMinutes} min timer</button>
                    </form>
                  ) : (
                    <p className="text-sm text-mid">Ends {g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "—"}. You&apos;ll be reminded to unassign it.</p>
                  )
                ) : (
                  <>
                    <p className="font-mono text-xs text-mid">
                      {formatUsd(g.spentMicros)} of {formatUsd(g.budgetMicros)} · {usage.requests} requests · {usage.blocked} blocked. Prompts are never visible to you.
                    </p>
                    <details><summary className="text-sm text-mid">Manage limits</summary><div className="mt-3"><LimitsForm
                      grantId={g.id}
                      maxRpm={g.maxRpm}
                      maxTokensPerRequest={g.maxTokensPerRequest}
                      privacyFloor={g.privacyFloor}
                      expiresAt={g.expiresAt}
                      showPrivacy={false}
                    /></div></details>
                  </>
                )}
                <form action={revokeAction}>
                  <input type="hidden" name="grantId" value={g.id} />
                  <button className="btn-danger" type="submit">Revoke now</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="kicker">Your listings</h2>
        {listings.length === 0 ? (
          <p className="mt-3 text-sm text-mid">Nothing listed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {listings.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{l.title}</span>
                <span className="pill">{l.service}</span>
                <span className="text-mid">{l.status}</span>
                <form action={toggleListingAction}>
                  <input type="hidden" name="listingId" value={l.id} />
                  <input type="hidden" name="status" value={l.status === "active" ? "paused" : "active"} />
                  <button className="btn-ghost" type="submit">{l.status === "active" ? "Pause" : "Resume"}</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="kicker">2 · New listing</h2>
        {ready ? (
          <div className="mt-4">
            <ListingForm action={createListingAction} services={services} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-mid">Add a payout method above first.</p>
        )}
      </section>
    </div>
  );
}
