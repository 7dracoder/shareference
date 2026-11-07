import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shareference: share AI and tool access without sharing accounts",
  description:
    "Private inference pool and capability-scoped account sharing. Buy and sell limited access; credentials never leave the vault.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Suspense fallback={<div className="h-14 border-b border-line" />}>
          <Nav />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl px-5 py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-6 font-mono text-xs text-low">
          Shareference · built at LOCALHOST NYC on Darkbloom, Tinfoil, Superlinked SIE and cognee. Money goes directly to recipients.
        </footer>
      </body>
    </html>
  );
}
