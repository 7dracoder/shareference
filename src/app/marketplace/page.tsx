import Link from "next/link";
import { activeListings, type Listing } from "@/lib/listings";
import { getNode, type ComputeNode } from "@/lib/nodes";
import { formatCents, formatUsd } from "@/lib/pricing";
import { serviceName } from "@/lib/services";
import { ServiceMark } from "@/components/service-mark";

function priceLine(l: Listing): string {
  if (l.kind === "seat") return `${formatCents(l.seatPriceCents)} for ${l.seatMinutes} min`;
  if (l.kind === "compute") return `${formatCents(l.seatPriceCents)} per hour`;
  if (l.kind === "pool") return `Prepaid credit from ${formatCents(l.minPurchaseCents)}`;
  return `${formatUsd(l.pricePer1kMicros)} per 1K tokens`;
}

const KIND_LABEL: Record<Listing["kind"], string> = { pool: "Pool", api_key: "API credit", seat: "Team seat", compute: "Computer" };

export default async function MarketplacePage() {
  const listings = await activeListings();
  const nodes = new Map<string, ComputeNode | null>(
    await Promise.all(listings.flatMap((l) => (l.nodeId ? [Promise.all([l.nodeId, getNode(l.nodeId)] as const)] : []))),
  );
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Listings</h1>
      <p className="mt-3 max-w-2xl text-mid">
        Everything here is time- or budget-limited, and the owner can end it at any time. You get your own key, never the owner&apos;s login or API key.
      </p>
      {listings.length === 0 ? (
        <p className="mt-8 text-mid">Nothing listed right now.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
          {listings.map((l) => {
            const node = l.nodeId ? nodes.get(l.nodeId) : null;
            return (
              <li key={l.id}>
                <Link href={`/marketplace/${l.id}`} className="grid gap-3 px-5 py-4 transition hover:bg-ink sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-5">
                  <ServiceMark id={l.kind === "pool" ? "openai-compatible" : l.service} size={28} />
                  <div className="min-w-0">
                    <h2 className="font-medium">{l.title}</h2>
                    <p className="mt-1 text-sm text-low">
                      {serviceName(l.service)} · {KIND_LABEL[l.kind]}
                      {l.providerId && ` · ${l.providerAlias}`}
                      {node && <> · {node.online ? <span className="text-acid">online</span> : "offline"}{node.specs.gpu ? ` · ${node.specs.gpu}` : ""}</>}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-mid">{l.description}</p>
                  </div>
                  <p className="text-sm font-medium sm:text-right">{priceLine(l)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
