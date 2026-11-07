import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { LogoMark } from "@/components/logo";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shareference",
  description: "Share unused AI credit, team seats, or the AI models on your own computer, with limits you control.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const content = <>
        <a href="#main" className="skip-link">Skip to content</a>
        <Suspense fallback={<div className="h-14 border-b border-line bg-panel" />}><Nav /></Suspense>
        <main id="main" className="mx-auto w-full max-w-6xl px-5 py-10">{children}</main>
        <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 border-t border-line px-5 py-6 text-xs text-low">
          <span className="flex items-center gap-2"><LogoMark size={16} />Shareference</span>
          <div className="flex gap-5"><Link className="hover:text-hi" href="/guide">How it works</Link><Link className="hover:text-hi" href="/verify">Privacy</Link></div>
        </footer>
      </>;
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider signInUrl="/login" signUpUrl="/signup" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard" appearance={{ options: { logoImageUrl: "/icon.svg", logoLinkUrl: "/", unsafe_disableDevelopmentModeWarnings: true }, variables: { colorPrimary: "#1f6f43" } }}>{content}</ClerkProvider> : content}
      </body>
    </html>
  );
}
