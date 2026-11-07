import { requireUser } from "@/lib/auth";
import { listingsByProvider, getListing } from "@/lib/listings";
import { grantsForProvider, usageSummary } from "@/lib/grants";
import { acceptedMethods, canReceivePayments, pendingForProvider, METHOD_LABEL, type PayMethod } from "@/lib/payments";
import { SERVICE_POLICIES } from "@/lib/policy";
import { nodesForProvider, specLines } from "@/lib/nodes";
import { feePercent, formatCents, formatUsd } from "@/lib/pricing";
import { aliasFrom, aliasMap } from "@/lib/users";
import { ActionForm } from "@/components/action-form";
import { ConnectComputer } from "@/components/connect-computer";
import { ListingForm } from "@/components/listing-form";
import { LimitsForm } from "@/components/limits-form";
import { ServiceMark } from "@/components/service-mark";
import {
  assignSeatAction,
  confirmReceiptAction,
  connectComputerAction,
  createListingAction,
  revokeAction,
  savePayoutAction,
  toggleListingAction,
} from "@/app/actions/provider";

export default async function ProviderPage() {
  const user = await requireUser("/provider");
  const [listings, allGrants, pending, computers] = await Promise.all([
    listingsByProvider(user.id),
    grantsForProvider(user.id),
    pendingForProvider(user.id),
    nodesForProvider(user.id),
  ]);
  const grants = allGrants.filter((g) => g.status === "active" || g.status === "pending_assignment");
  const [details, aliases] = await Promise.all([
    Promise.all(grants.map(async (g) => ({ grant: g, listing: await getListing(g.listingId), usage: await usageSummary(g.id) }))),
    aliasMap([...grants.map((g) => g.buyerId), ...pending.map((p) => p.buyerId)]),
  ]);
  const pm = user.payoutMethods;
  const accepted = acceptedMethods();
  const ready = canReceivePayments(pm);
  const services = SERVICE_POLICIES.filter((s) => s.rule !== "forbidden" && s.rule !== "own_hardware").map((s) => ({ id: s.id, name: s.name, kinds: s.kinds, note: s.note, baseUrl: s.baseUrl }));
  const connected = computers.filter((c) => c.lastSeen !== null);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Share access</h1>
        <p className="mt-3 max-w-2xl text-mid">
          List API credit, a team seat, or your own computer. Buyers pay you directly and send the {feePercent()} platform fee separately.
          They see you as <span className="font-medium text-hi">{user.alias}</span>.
        </p>
      </div>

      <details className="card" open={!ready}>
        <summary className="font-medium">{ready ? "Payment details (done)" : "Step 1: add payment details"}</summary>
        {accepted.length === 0 ? (
          <p className="mt-2 text-sm text-mid">Payments aren&apos;t open yet. The platform owner still needs to add a payout method.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-mid">Add at least one. Buyers can pay with {accepted.map((m) => METHOD_LABEL[m]).join(", ")}. Only a buyer with an order sees these, on their order page.</p>
            <div className="mt-4">
              <ActionForm action={savePayoutAction} submitLabel="Save payment details">
                <div className="grid gap-3 sm:grid-cols-2">
                  {accepted.includes("zelle") && <>
                    <label className="block"><span className="label">Zelle email or phone</span><input className="input" name="zelle" defaultValue={pm.zelle} /></label>
                    <label className="block"><span className="label">Name on Zelle</span><input className="input" name="zelleName" defaultValue={pm.zelleName} /></label>
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
          <h2 className="text-lg font-semibold">Payments to confirm</h2>
          <p className="mt-1 text-sm text-mid">Find the reference code in your payment app, then confirm. The buyer gets access once you and the platform have both confirmed.</p>
          <ul className="mt-3 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="font-mono">{p.reference}</span>
                <span>{aliasFrom(aliases, p.buyerId)}</span>
                <span>{formatCents(p.providerCents)} via {METHOD_LABEL[p.method as PayMethod]}</span>
                <span className="text-low">{p.status === "buyer_marked_sent" ? "Buyer says it's sent" : "Not sent yet"}</span>
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
        <h2 className="text-lg font-semibold">Buyers</h2>
        {details.length === 0 ? (
          <p className="mt-2 text-sm text-mid">Nobody is using your access right now.</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {details.map(({ grant: g, listing, usage }) => (
              <article key={g.id} className="card space-y-3">
                <div className="flex justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{listing?.title}</h3>
                    <p className="text-sm text-low">{aliasFrom(aliases, g.buyerId)}</p>
                  </div>
                  <span className="text-sm text-mid">{g.status === "pending_assignment" ? "Waiting for seat" : "Active"}</span>
                </div>
                {listing?.kind === "seat" ? (
                  g.status === "pending_assignment" ? (
                    <form action={assignSeatAction} className="space-y-2">
                      <p className="text-sm text-mid">Add the buyer to your {listing.service} team in the vendor&apos;s admin console, then start the timer.</p>
                      <p className="text-sm">Invite <span className="select-all font-mono">{g.deliveryEmail ?? "the buyer (contact them through the payment app)"}</span></p>
                      <input type="hidden" name="grantId" value={g.id} />
                      <button className="btn" type="submit">Seat assigned, start the {listing.seatMinutes} min timer</button>
                    </form>
                  ) : (
                    <p className="text-sm text-mid">Ends {g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "—"}. You&apos;ll be reminded to remove them.</p>
                  )
                ) : (
                  <>
                    <p className="text-sm text-mid">
                      {listing?.kind === "compute"
                        ? `Ends ${g.expiresAt ? new Date(g.expiresAt).toLocaleString() : "—"}. ${usage.requests} requests, ${usage.blocked} blocked.`
                        : `${formatUsd(g.spentMicros)} of ${formatUsd(g.budgetMicros)} used. ${usage.requests} requests, ${usage.blocked} blocked. You can't see their prompts.`}
                    </p>
                    <details><summary className="text-sm text-mid">Change limits</summary><div className="mt-3"><LimitsForm
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
                  <button className="btn-danger" type="submit">End access now</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Your listings</h2>
        {listings.length === 0 ? (
          <p className="mt-2 text-sm text-mid">Nothing listed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-panel">
            {listings.map((l) => (
              <li key={l.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3 text-sm">
                <ServiceMark id={l.service} size={20} />
                <span className="font-medium">{l.title}</span>
                <span className="text-mid">{l.status === "active" ? "Listed" : l.status === "paused" ? "Paused" : l.status}</span>
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your computers</h2>
        <p className="max-w-2xl text-sm text-mid">
          Rent out the AI models running on your own machine through Ollama or LM Studio. A small script on your computer picks up buyers&apos; requests while it&apos;s running. Close it and you&apos;re offline.
        </p>
        {connected.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {connected.map((c) => (
              <li key={c.id} className="space-y-2 px-4 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium">{c.specs.gpu || c.specs.cpu || "Computer"}</span>
                  <span className={c.online ? "text-acid" : "text-low"}>{c.online ? "Online" : `Offline, last seen ${new Date(c.lastSeen ?? 0).toLocaleString()}`}</span>
                </div>
                <p className="text-mid">{specLines(c.specs).join(" · ")}</p>
                <p className="text-mid">Models: {c.models.length ? c.models.join(", ") : "none found. Start Ollama or LM Studio and download a model."}</p>
                <ConnectComputer action={connectComputerAction} nodeId={c.id} label="Get a new command" />
              </li>
            ))}
          </ul>
        )}
        <ConnectComputer action={connectComputerAction} label={connected.length ? "Connect another computer" : "Connect a computer"} />
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">New listing</h2>
        {ready ? (
          <div className="mt-4">
            <ListingForm
              action={createListingAction}
              services={services}
              computers={connected.map((c) => ({ id: c.id, label: `${c.specs.gpu || c.specs.cpu || "Computer"}${c.online ? "" : " (offline)"}` }))}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-mid">Add your payment details first.</p>
        )}
      </section>
    </div>
  );
}
