import Link from "next/link";
import { Playground } from "@/components/playground";
import { requireUser } from "@/lib/auth";
import { grantsForBuyer } from "@/lib/grants";
import { getListing } from "@/lib/listings";
export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ grant?: string }> }) {
  const user = await requireUser("/playground");
  const { grant } = await searchParams;
  const grants = (await grantsForBuyer(user.id)).filter((g) => g.status === "active" && g.features.includes("chat"));
  const options = await Promise.all(grants.map(async (g) => ({ id: g.id, title: (await getListing(g.listingId))?.title || "API access" })));
  return <div className="space-y-6"><div><Link href="/dashboard" className="text-sm text-mid">← My access</Link><h1 className="mt-4 text-3xl font-semibold tracking-tight">Try your access</h1><p className="mt-3 max-w-2xl text-mid">Choose your access and send a message. No API key to copy.</p></div>{options.length > 0 ? <Playground options={options} initialGrantId={options.find((o) => o.id === grant)?.id} /> : <div className="card space-y-4"><p className="text-mid">You’ll need active chat access to send a message.</p><Link href="/marketplace" className="btn">Browse listings</Link></div>}</div>;
}
