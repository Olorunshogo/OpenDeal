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
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <NetworkBanner />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">
              Toy marketplace
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
              One listing
            </h1>
          </div>
          <p className="text-sm text-[var(--ink-muted)]">{LISTING.blurb}</p>
        </div>
        <article className="flex flex-col items-start gap-4 rounded border border-[var(--line)] p-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl">{LISTING.title}</h2>
            <p className="text-sm">{LISTING.amountSats.toLocaleString()} sats</p>
          </div>
          <Link
            href={href}
            className="inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
          >
            Open as a deal
          </Link>
        </article>
      </div>
    </AppShell>
  );
}
