import { Fragment, Suspense } from "react";
import { verifyTinfoil } from "@/lib/integrations/tinfoil";

const TRUST_MODEL = [
  {
    tier: "Fast (Superlinked SIE)",
    sees: "SIE operator sees the request.",
    use: "Embeddings, rerank, extraction, short non-sensitive chat.",
  },
  {
    tier: "Private (Darkbloom)",
    sees: "Encrypted to a hardware-attested Mac; hidden from the Mac's operator.",
    use: "Default for chat.",
  },
  {
    tier: "Verified (Tinfoil)",
    sees: "Only an attested enclave can decrypt. Tinfoil cannot read it.",
    use: "Anything with personal data. Forced automatically when SIE detects PII.",
  },
];

async function TinfoilStatus() {
  const v = await verifyTinfoil();
  if (!v.configured) return <p className="text-sm text-mid">Tinfoil is not configured on this deployment yet.</p>;
  return (
    <div className="space-y-3 text-sm">
      <p className={v.verified ? "text-acid" : "text-bad"}>
        {v.verified ? "Enclave verified: code and hardware measurements match." : `Verification failed${v.error ? `: ${v.error}` : ""}`}
      </p>
      <dl className="grid grid-cols-[160px_1fr] gap-2 font-mono text-xs">
        {v.enclaveHost && (<><dt className="text-low">Enclave</dt><dd className="break-all">{v.enclaveHost}</dd></>)}
        {v.configRepo && (<><dt className="text-low">Config repo</dt><dd className="break-all">{v.configRepo}</dd></>)}
        {v.releaseTag && (<><dt className="text-low">Release</dt><dd>{v.releaseTag}</dd></>)}
        {v.codeDigest && (<><dt className="text-low">Release digest</dt><dd className="break-all">{v.codeDigest}</dd></>)}
        {Object.entries(v.steps).map(([k, s]) => (
          <Fragment key={k}><dt className="text-low">{k}</dt><dd>{s}</dd></Fragment>
        ))}
      </dl>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="kicker">Verify</p>
        <h1 className="mt-3 font-mono text-3xl">Don&apos;t trust us. Check.</h1>
        <p className="mt-3 max-w-2xl text-mid">
          The verified tier uses Tinfoil&apos;s SDK, which checks the enclave&apos;s attestation against a release published to the Sigstore transparency
          log before sending anything. Shareference itself is packaged to run as a Tinfoil Container, so the router and vault can be attested the same way.
        </p>
      </div>

      <section className="card">
        <h2 className="kicker">Live Tinfoil attestation</h2>
        <div className="mt-4">
          <Suspense fallback={<p className="text-sm text-low">Verifying enclave…</p>}>
            <TinfoilStatus />
          </Suspense>
        </div>
      </section>

      <section className="card">
        <h2 className="kicker">Who can see what</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-low">
            <tr><th className="py-2 pr-4 font-normal">Tier</th><th className="py-2 pr-4 font-normal">Who can read your request</th><th className="py-2 font-normal">Used for</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {TRUST_MODEL.map((r) => (
              <tr key={r.tier}><td className="py-2 pr-4">{r.tier}</td><td className="py-2 pr-4 text-mid">{r.sees}</td><td className="py-2 text-mid">{r.use}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-6 space-y-2 text-sm text-mid">
          <li>· Shareference stores only usage metadata: token counts, cost, latency, backend. Never prompts or outputs.</li>
          <li>· Owners&apos; credentials are sealed with AES-256-GCM. Buyers get capped sub-keys; owners see usage counts, never content.</li>
          <li>· Buyers and owners see each other only as random aliases. Payout handles are shown only to the buyer of a specific order.</li>
          <li>· Fallbacks only move to a more private tier, never a less private one.</li>
        </ul>
      </section>
    </div>
  );
}
