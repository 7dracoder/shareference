import Link from "next/link";
import { feePercent } from "@/lib/pricing";

const WAYS = [
  ["API credit", "Paste a key from Anthropic, OpenAI, Gemini, Baseten, OpenRouter, Groq and others. Each buyer gets their own key with a budget. Yours stays encrypted on our server."],
  ["Team seats", "Lend a seat on Claude Team, ChatGPT Business, Cursor, Copilot and similar plans for a set time. You add and remove the buyer in your admin console."],
  ["Your computer", "Run one command and buyers can use the models in your Ollama or LM Studio, paid by the hour. Their access ends when the time is up."],
];

const BUYING = [
  "Pick a listing and see the price, limits and models up front.",
  "Pay the owner directly with Zelle, Venmo, PayPal, Cash App or USDC. The owner confirms they got it.",
  "Get your own key. It works with any app that speaks the OpenAI API, and it stops when your credit or time runs out.",
];

export default function Home() {
  return (
    <div className="space-y-16 pb-6">
      <section className="max-w-3xl pt-6 sm:pt-12">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Rent out the AI access you aren&apos;t using.</h1>
        <p className="mt-5 text-lg leading-relaxed text-mid">
          Spare API credit, an empty team seat, or a computer that sits idle with local models on it. List it, set a price and limits,
          and people pay you directly to use it. They get their own key, never your login.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/marketplace" className="btn">Browse listings</Link>
          <Link href="/provider" className="btn-ghost">Share something</Link>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">What you can share</h2>
        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {WAYS.map(([title, text]) => (
            <div key={title} className="bg-panel p-5">
              <h3 className="font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mid">{text}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-sm text-mid">
          Personal plans like Claude Pro, Claude Max or ChatGPT Plus can&apos;t be listed. Sharing one means handing over your login, which breaks
          the provider&apos;s terms and puts your account at risk.
        </p>
      </section>

      <section className="max-w-3xl">
        <h2 className="text-xl font-semibold">How buying works</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-mid">
          {BUYING.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p className="mt-5 text-sm text-mid">
          Shareference keeps {feePercent()} of each order, paid as a separate transfer. Read <Link className="text-acid underline" href="/guide">the full guide</Link> or{" "}
          <Link className="text-acid underline" href="/verify">where your requests go</Link>.
        </p>
      </section>
    </div>
  );
}
