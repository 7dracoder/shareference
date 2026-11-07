import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getPayment, METHOD_LABEL, type PayMethod } from "@/lib/payments";
import { getListing } from "@/lib/listings";
import { formatCents } from "@/lib/pricing";
import { buyerZelleQr } from "@/lib/zelle-qr";
import { usdcNetworkLabel } from "@/lib/integrations/usdc";
import { RefreshStatus } from "@/components/refresh-status";
import { getGrant } from "@/lib/grants";
import { ActionForm } from "@/components/action-form";
import { cancelOrderAction, markSentAction, submitUsdcAction } from "@/app/actions/buyer";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const payment = await getPayment(id);
  if (!payment || payment.buyerId !== user.id) notFound();
  const listing = await getListing(payment.listingId);
  const grant = payment.grantId ? await getGrant(payment.grantId) : null;
  const open = payment.status === "awaiting_payment" || payment.status === "buyer_marked_sent";
  const isUsdc = payment.method === "usdc";
  const isZelle = payment.method === "zelle";
  const methodLabel = payment.method === "demo" ? "Demo payment" : METHOD_LABEL[payment.method as PayMethod];
  const qr = open && isZelle ? await buyerZelleQr({ reference: payment.reference, grossCents: payment.grossCents }) : null;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">{listing?.title ?? "Order"}</h1>
      <p className="mt-2 text-mid">
        Order {payment.reference} · {formatCents(payment.grossCents)}
      </p>

      {payment.status === "completed" && (
        <div className="card mt-6 border-acid/40">
          <p className="text-acid">
            {grant?.status === "pending_assignment"
              ? "Payment confirmed. Your provider will send your seat invitation."
              : grant?.expiresAt && listing?.kind === "compute"
                ? `Payment confirmed. Your access works until ${new Date(grant.expiresAt).toLocaleString()}.`
                : "Payment confirmed. Your access is ready."}
          </p>
          <Link href="/dashboard" className="btn mt-4">Go to my access</Link>
        </div>
      )}
      {payment.status === "canceled" && <div className="card mt-6 text-mid">This order was canceled.</div>}

      {open && <RefreshStatus />}
      {open && (
        <div className="card mt-6 space-y-5">
          <div>
            <h2 className="font-semibold">Pay with {methodLabel}</h2>
            <p className="mt-2 text-sm text-mid">
              Send <span className="font-medium text-hi">{formatCents(payment.grossCents)}</span>
              {isZelle ? " with Zelle" : ""}. Put{" "}
              <code className="font-mono font-medium text-hi">{payment.reference}</code> in the memo.
            </p>
          </div>

          {qr && (
            <div className="flex flex-col items-center gap-3 py-2">
              {/* Bank QR may be a remote URL; generated QR is a data URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.imageSrc} alt="Zelle payment QR code" width={240} height={240} className="rounded-md border border-line bg-white p-2" />
              <p className="text-center text-sm text-mid">
                Scan in your banking app · pay {qr.recipientLabel}
              </p>
            </div>
          )}

          {isUsdc && (
            <>
              <p className="text-sm text-mid">Send USDC on {usdcNetworkLabel()} for the full amount above, then paste the transaction details.</p>
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
            </>
          )}

          {!isUsdc && (
            <div className="flex flex-wrap items-center gap-3">
              {payment.status === "awaiting_payment" ? (
                <form action={markSentAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button className="btn" type="submit">I&apos;ve paid</button>
                </form>
              ) : payment.feeConfirmedAt ? (
                <p className="text-sm text-mid">Deposit confirmed. Access unlocks once the provider confirms they received their payout. This page updates on its own.</p>
              ) : (
                <p className="text-sm text-mid">Marked as paid. Waiting for Shareference to confirm the deposit. This page updates on its own.</p>
              )}
              {payment.status === "awaiting_payment" && (
                <form action={cancelOrderAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <button className="btn-ghost" type="submit">Cancel order</button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
