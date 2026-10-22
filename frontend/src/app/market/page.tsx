"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";

const LISTING = {
  title: "Used laptop",
  amountSats: 50_000,
  blurb: "Toy marketplace listing. Creating a deal still uses the OpenDeal API, not a second ledger.",
};

export default function MarketPage() {
  const href = `/deals/new?title=${encodeURIComponent(LISTING.title)}&amount_sats=${LISTING.amountSats}`;
  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <NetworkBanner />
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">
          Toy marketplace
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">One listing</h1>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">{LISTING.blurb}</p>
        <article className="mt-6 rounded border border-[var(--line)] p-4">
          <h2 className="text-xl">{LISTING.title}</h2>
          <p className="mt-2 text-sm">{LISTING.amountSats.toLocaleString()} sats</p>
          <Link
            href={href}
            className="mt-4 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
          >
            Open as a deal
          </Link>
        </article>
      </div>
    </AppShell>
  );
}
