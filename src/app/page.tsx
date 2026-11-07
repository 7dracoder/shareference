import Link from "next/link";
import { TIER_INFO, TIERS, feePercent } from "@/lib/pricing";

const STEPS = [
  {
    title: "Owners list access, not accounts",
    body: "Share a team's inference credits, an API key, or a team-plan seat. Credentials are sealed in the vault and never shown to anyone.",
  },
  {
    title: "Buyers get only the feature they need",
    body: "Each purchase becomes a grant: specific endpoints and models, a budget, a rate limit, a time window. Everything else is blocked.",
  },
  {
    title: "Owners keep control",
    body: "Change limits or revoke any time. Owners see usage counts and cost, never the buyer's prompts or outputs.",
  },
  {
    title: "Money goes straight to people",
    body: `Buyers pay the provider directly by Zelle, Venmo, Cash App, PayPal or USDC. ${feePercent()} goes directly to the platform. Switchboard never holds funds.`,
  },
];

const SPONSORS = [
  { name: "Tinfoil", role: "Verified tier: attested enclave inference; the app is built to run as a Tinfoil Container." },
  { name: "Darkbloom", role: "Private tier: encrypted inference on hardware-attested Apple Silicon Macs." },
  { name: "Superlinked SIE", role: "Fast tier + embeddings, rerank, and the PII detector that upgrades sensitive requests." },
  { name: "cognee", role: "Shared agent memory with per-agent datasets: routing, finance, access, customers." },
];

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="pt-6">
        <p className="kicker">LOCALHOST NYC · sovereign agentic organization</p>
        <h1 className="mt-5 max-w-3xl font-mono text-4xl leading-tight tracking-tight sm:text-6xl">
          Share AI and tool access <span className="text-acid">without sharing accounts.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-mid">
          Switchboard is a private inference pool and a marketplace for limited, revocable access. One OpenAI-compatible key, routed
          by cost and privacy. Owners set the limits; buyers get only what they paid for.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/marketplace" className="btn">Browse the marketplace</Link>
          <Link href="/provider" className="btn-ghost">Sell spare access</Link>
          <Link href="/verify" className="btn-ghost">Verify the enclave</Link>
        </div>
      </section>

      <section>
        <h2 className="kicker">Private inference pool</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t} className="card">
              <div className="flex items-baseline justify-between">
                <h3 className="font-mono text-lg">{TIER_INFO[t].label}</h3>
                <span className="pill">{TIER_INFO[t].backend}</span>
              </div>
              <p className="mt-3 text-sm text-mid">{TIER_INFO[t].guarantee}</p>
              <p className="mt-4 font-mono text-sm text-acid">${(TIER_INFO[t].pricePer1kMicros / 1_000_000).toFixed(4)} / 1K tokens</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-low">
          Requests are scanned for personal data on SIE first. If any is found, the request is upgraded to the verified tier
          automatically. Fallbacks only go to a more private backend, never a less private one.
        </p>
      </section>

      <section>
        <h2 className="kicker">How sharing works</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card">
              <span className="font-mono text-2xl text-acid">0{i + 1}</span>
              <h3 className="mt-3 font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-mid">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="kicker">Built on</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {SPONSORS.map((s) => (
            <div key={s.name} className="card">
              <h3 className="font-mono">{s.name}</h3>
              <p className="mt-2 text-sm text-mid">{s.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="kicker">Use it from any OpenAI client</h2>
        <pre className="code mt-4">{`curl ${"$"}SWITCHBOARD_URL/api/v1/chat/completions \\
  -H "Authorization: Bearer sb_..." \\
  -H "x-switchboard-tier: private" \\
  -d '{"messages":[{"role":"user","content":"hello"}]}'`}</pre>
      </section>
    </div>
  );
}
