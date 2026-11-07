import Link from "next/link";
import { activeListings, type Listing } from "@/lib/listings";
import { formatCents, formatUsd } from "@/lib/pricing";

function priceLine(l: Listing): string {
  if (l.kind === "seat") return `${formatCents(l.seatPriceCents)} for ${l.seatMinutes} min`;
  if (l.kind === "pool") return `Prepaid credit from ${formatCents(l.minPurchaseCents)}`;
  return `${formatUsd(l.pricePer1kMicros)} / 1K tokens · from ${formatCents(l.minPurchaseCents)}`;
}

const KIND_LABEL: Record<Listing["kind"], string> = { pool: "Inference pool", api_key: "Shared API", seat: "Team seat" };

export default async function MarketplacePage() {
  const listings = await activeListings();
  return (
    <div>
      <p className="kicker">Marketplace</p>
      <h1 className="mt-3 font-mono text-3xl">Buy limited, revocable access</h1>
      <p className="mt-3 max-w-2xl text-mid">
        Every purchase becomes a grant with its own limits. You never see the owner&apos;s credentials or account details, and the owner
        never sees your prompts.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {listings.map((l) => (
          <Link key={l.id} href={`/marketplace/${l.id}`} className="card block transition hover:border-mid">
            <div className="flex items-center justify-between gap-3">
              <span className="pill">{KIND_LABEL[l.kind]}</span>
              <span className="font-mono text-xs text-low">by {l.providerAlias}</span>
            </div>
            <h2 className="mt-3 text-lg font-medium">{l.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm text-mid">{l.description}</p>
            <p className="mt-4 font-mono text-sm text-acid">{priceLine(l)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
