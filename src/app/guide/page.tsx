import Link from "next/link";
import { feePercent } from "@/lib/pricing";

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>

      <section className="card space-y-4">
        <h2 className="text-xl font-semibold">Buying</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-mid">
          <li>Open a listing and check the models, price and limits. Credit lasts 30 days from activation. Computer time is sold by the hour.</li>
          <li>Sign in and place an order. You&apos;ll see exactly how much to send and to whom before any money moves.</li>
          <li>Send the payments. For Zelle, Venmo, PayPal and Cash App, each recipient confirms by hand, so it isn&apos;t instant. USDC transfers are checked on-chain.</li>
          <li>Open My access to copy your key or try it in the playground. It works with any app that uses the OpenAI API.</li>
        </ol>
        <p className="text-sm text-mid">
          Owners can lower limits or end access. Ending access turns off the key but doesn&apos;t refund you. Sort out payment problems with the
          recipient through your payment app.
        </p>
        <Link className="btn" href="/marketplace">Browse listings</Link>
      </section>

      <section className="card space-y-4">
        <h2 className="text-xl font-semibold">Sharing</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-mid">
          <li>Add a way to get paid (Zelle, Venmo, PayPal, Cash App or USDC, depending on what&apos;s enabled).</li>
          <li>
            Create a listing:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong className="text-hi">API credit:</strong> pick the provider, paste your key, choose models and a price per 1K tokens. The key is encrypted and never shown to buyers.</li>
              <li><strong className="text-hi">Team seat:</strong> set a price and duration. After payment you add the buyer in your admin console and start the timer.</li>
              <li><strong className="text-hi">Your computer:</strong> click Connect a computer and run the command it gives you. It shares whatever models you have in Ollama or LM Studio, along with your GPU, RAM and free disk. Set an hourly price.</li>
            </ul>
          </li>
          <li>When a buyer pays, check your payment app and confirm. The platform confirms its fee separately.</li>
          <li>Watch usage, change limits or end access from your Share page. Pausing a listing stops new orders. Existing buyers keep access until it ends.</li>
        </ol>
        <p className="text-sm text-mid">
          The platform fee is {feePercent()} of each order. Buyers send your share and the fee as two separate payments, and every order shows the split.
        </p>
        <Link className="btn-ghost" href="/provider">Start sharing</Link>
      </section>

      <section className="card space-y-3">
        <h2 className="text-xl font-semibold">Sharing your computer</h2>
        <p className="text-sm leading-relaxed text-mid">
          You need Node.js 18 or newer and Ollama or LM Studio with at least one model downloaded. The script only talks to Shareference over HTTPS
          and to your local model server. Nothing on your computer opens to the internet. Buyers can only send chat requests to your models.
          They can&apos;t run commands, read files or see anything else.
        </p>
        <p className="text-sm leading-relaxed text-mid">
          The script prints each request it answers. Close it to go offline. Buyers&apos; keys stop working when their hours run out, or as soon as you
          end their access. Their prompts pass through your machine, and the listing tells them so.
        </p>
      </section>
    </div>
  );
}
