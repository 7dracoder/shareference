import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPayment, METHOD_LABEL, paymentLegs } from "@/lib/payments";
import { getListing } from "@/lib/listings";
import { formatCents } from "@/lib/pricing";
import { usdcNetworkLabel } from "@/lib/integrations/usdc";
import { ActionForm } from "@/components/action-form";
import { cancelOrderAction, markSentAction, submitUsdcAction } from "@/app/actions/buyer";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const payment = getPayment(id);
  if (!payment || payment.buyerId !== user.id) notFound();
  const listing = getListing(payment.listingId);
  const legs = paymentLegs(payment);
  const open = payment.status === "awaiting_payment" || payment.status === "buyer_marked_sent";
  const isUsdc = payment.method === "usdc";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="kicker">Order {payment.reference}</p>
      <h1 className="mt-3 font-mono text-2xl">{listing?.title ?? "Order"}</h1>
      <p className="mt-2 text-mid">
        Total {formatCents(payment.grossCents)} · {payment.method === "demo" ? "Demo payment" : METHOD_LABEL[payment.method]}
      </p>

      {payment.status === "completed" && (
        <div className="card mt-6 border-acid/50">
          <p className="text-acid">Paid. Your access is ready.</p>
          <Link href="/dashboard" className="btn mt-4">Go to my access</Link>
        </div>
      )}
      {payment.status === "canceled" && <div className="card mt-6 text-mid">This order was canceled.</div>}

      {open && (
        <>
          <div className="card mt-6 space-y-4">
            <h2 className="kicker">Send these payments directly</h2>
            <p className="text-sm text-mid">
              {isUsdc
                ? `Send USDC on ${usdcNetworkLabel()} from one wallet to each address below.`
                : `Open your ${METHOD_LABEL[payment.method as keyof typeof METHOD_LABEL] ?? ""} app and send each amount below. Put the reference `}
              {!isUsdc && <code className="font-mono text-acid">{payment.reference}</code>}
              {!isUsdc && " in the memo so recipients can match it."}
            </p>
            <ul className="divide-y divide-line">
              {legs.map((leg) => (
                <li key={leg.recipient} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-mid">{leg.label}</p>
                    <p className="select-all font-mono text-sm break-all">{leg.handle}</p>
                    {leg.holderName && <p className="text-xs text-low">Name on account: {leg.holderName}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg">{formatCents(leg.cents)}</p>
                    <p className={`text-xs ${leg.confirmed ? "text-acid" : "text-low"}`}>{leg.confirmed ? "Received" : "Waiting for confirmation"}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {isUsdc ? (
            <div className="card mt-4">
              <h2 className="kicker">Verify on-chain</h2>
              <p className="mt-2 text-sm text-mid">Paste the transaction hash(es). Access is issued as soon as the transfers check out.</p>
              <div className="mt-4">
                <ActionForm action={submitUsdcAction} submitLabel="Verify payment" pendingLabel="Checking the chain…">
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <label className="block">
                    <span className="label">Wallet you paid from</span>
                    <input className="input font-mono" name="payer" placeholder="0x…" required />
                  </label>
                  <label className="block">
                    <span className="label">Transaction hash(es)</span>
                    <textarea className="input font-mono" name="hashes" rows={2} placeholder="0x… 0x…" required />
                  </label>
                </ActionForm>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {payment.status === "awaiting_payment" ? (
                <form action={markSentAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button className="btn" type="submit">I&apos;ve sent the payments</button>
                </form>
              ) : (
                <p className="text-sm text-mid">Marked as sent. Your key is issued once each recipient confirms. Refresh to check.</p>
              )}
              {payment.providerConfirmedAt === null && payment.feeConfirmedAt === null && (
                <form action={cancelOrderAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button className="btn-ghost" type="submit">Cancel order</button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
