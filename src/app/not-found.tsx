import Link from "next/link";
export default function NotFound() { return <div className="mx-auto max-w-lg space-y-4 py-10"><h1 className="text-3xl font-semibold">Page not found</h1><p className="text-mid">The link may be old, or the listing was paused or removed.</p><Link href="/marketplace" className="btn">Browse listings</Link></div>; }
