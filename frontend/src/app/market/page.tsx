"use client";

import { ArrowRight, Laptop } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { NetworkBanner } from "@/components/NetworkBanner";
import SpotlightCard from "@/components/react-bits/SpotlightCard";
import { Amount, Badge, ButtonLink } from "@/components/ui";

const LISTING = {
  title: "Used laptop",
  amountSats: 50_000,
  blurb: "Toy marketplace listing. Creating a deal still uses the OpenDeal API, not a second ledger.",
};

export default function MarketPage() {
  const href = `/deals/new?title=${encodeURIComponent(LISTING.title)}&amount_sats=${LISTING.amountSats}`;
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 animate-rise">
        <NetworkBanner />
        <PageHeader eyebrow="Toy marketplace" title="One listing" description={LISTING.blurb} />
        <SpotlightCard
          spotlightColor="rgba(247, 147, 26, 0.18)"
          className="flex flex-col gap-6 rounded-3xl border border-line bg-glass p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
        >
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-violet/30 bg-violet/10 text-violet-soft">
              <Laptop aria-hidden="true" className="size-6" strokeWidth={1.6} />
            </span>
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-xl font-semibold text-ink">{LISTING.title}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Amount sats={LISTING.amountSats} size="sm" />
                <Badge tone="brand">2-of-3 escrow</Badge>
              </div>
            </div>
          </div>
          <ButtonLink href={href} trailing={<ArrowRight className="size-4" />}>
            Open as a deal
          </ButtonLink>
        </SpotlightCard>
      </div>
    </AppShell>
  );
}
