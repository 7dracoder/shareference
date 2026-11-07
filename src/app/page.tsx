import Link from "next/link";

const STEPS = [
  ["Choose your access", "Find an API that fits your work. See the price, models, and limits before you buy."],
  ["Pay, then connect", "Follow the payment instructions. Once payment is confirmed, your key appears in My access."],
  ["Stay in control", "Track your remaining credit and usage in one place. End access whenever you need to."],
];

export default function Home() {
  return <div className="space-y-16 pb-6">
    <section className="grid items-center gap-12 py-8 lg:grid-cols-[1.3fr_1fr] sm:py-14">
      <div>
        <p className="kicker">AI access, made simple</p>
        <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">The access you need.<br /><span className="text-acid">The control you want.</span></h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-mid">Get AI access with a budget you choose. Or provide access with limits you control. One place to manage it all.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/marketplace" className="btn">Get access <span aria-hidden>↗</span></Link><Link href="/provider" className="btn-ghost">Provide access</Link></div>
        <p className="mt-5 text-xs text-low">Your own access key. Clear usage. No shared passwords.</p>
      </div>
      <div className="card space-y-7 p-7 sm:p-9">
        <div className="flex items-center justify-between"><span className="text-sm font-medium">Two sides. One simple workspace.</span><span className="pill">Shareference</span></div>
        <div className="border-b border-line pb-6"><p className="kicker">For getters</p><h2 className="mt-3 text-xl font-medium">Connect and get to work.</h2><p className="mt-2 text-sm leading-relaxed text-mid">Browse access, choose your credit, and use your key with an OpenAI-compatible app.</p></div>
        <div><p className="kicker">For providers</p><h2 className="mt-3 text-xl font-medium">Share access on your terms.</h2><p className="mt-2 text-sm leading-relaxed text-mid">Connect your API, set a price, and manage each buyer’s limits from your dashboard.</p></div>
      </div>
    </section>
    <section><h2 className="text-2xl font-semibold tracking-tight">From browsing to building.</h2><ol className="mt-6 grid gap-5 md:grid-cols-3">{STEPS.map(([title, text], i) => <li key={title} className="card"><span className="text-sm text-acid">0{i+1}</span><h3 className="mt-5 font-medium">{title}</h3><p className="mt-2 text-sm leading-relaxed text-mid">{text}</p></li>)}</ol></section>
    <section className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-line px-6 py-7"><div><h2 className="font-medium">Know what happens to your data.</h2><p className="mt-2 text-sm text-mid">Understand routing, usage tracking, and who handles your requests.</p></div><Link className="btn-ghost" href="/verify">Read about privacy</Link></section>
  </div>;
}
