"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { listMyDeals, type DealSummary } from "@/lib/api";
import { useSession } from "@/lib/session";

const POLL_MS = 10_000;

export function MyDealsClient() {
  const session = useSession();
  const token = session?.token ?? "";
  const viewer = session?.pubkey;

  const dealsQuery = useQuery({
    queryKey: ["my-deals", viewer],
    queryFn: () => listMyDeals(token),
    enabled: Boolean(token),
    refetchInterval: POLL_MS,
  });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 animate-rise">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deals</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">My deals</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            Every deal where you are the seller, buyer, or mediator, most recently updated first.
          </p>
        </div>

        {!token ? (
          <p className="text-sm">
            <Link href="/onboarding?next=/deals" className="underline underline-offset-4">
              Sign in
            </Link>{" "}
            to see your deals.
          </p>
        ) : dealsQuery.isPending ? (
          <p className="text-sm text-[var(--ink-muted)]">Loading your deals…</p>
        ) : dealsQuery.isError ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {dealsQuery.error instanceof Error ? dealsQuery.error.message : "Could not load your deals."}
          </p>
        ) : dealsQuery.data.length === 0 ? (
          <div className="flex flex-col gap-2 text-sm text-[var(--ink-muted)]">
            <p>You have no deals yet.</p>
            <Link href="/deals/new" className="w-fit underline underline-offset-4">
              Create a deal
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {dealsQuery.data.map((deal) => (
              <DealRow key={deal.id} deal={deal} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function DealRow({ deal }: { deal: DealSummary }) {
  return (
    <li>
      <Link
        href={`/deals/${deal.id}`}
        className="flex flex-col gap-2 rounded border border-[var(--line)] p-4 transition hover:border-[var(--accent)] sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="break-words font-medium">{deal.title}</span>
          <span className="font-mono text-[10px] text-[var(--ink-muted)]">
            {deal.id.slice(0, 16)}… · updated {new Date(deal.updated_at).toLocaleString()}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-[var(--line)] px-2 py-0.5 text-[var(--ink-muted)]">
            you: {deal.role}
          </span>
          <span className="rounded border border-[var(--line)] px-2 py-0.5 text-[var(--ok)]">
            {deal.status}
          </span>
          <span className="text-[var(--ink-muted)]">
            {deal.amount_sats.toLocaleString()} sats · {deal.network}
          </span>
        </div>
      </Link>
    </li>
  );
}
