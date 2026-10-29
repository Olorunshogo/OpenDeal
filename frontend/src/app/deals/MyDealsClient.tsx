"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Inbox, Plus } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, Amount, Badge, ButtonLink, EmptyState, Skeleton, StatusBadge } from "@/components/ui";
import { listMyDeals, type DealSummary } from "@/lib/api";
import { useSession, type Session } from "@/lib/session";

const POLL_MS = 10_000;

export function MyDealsClient() {
  const session: Session | null = useSession();
  const token: string = session?.token ?? "";
  const viewer: string | undefined = session?.pubkey;

  const dealsQuery = useQuery({
    queryKey: ["my-deals", viewer],
    queryFn: () => listMyDeals(token),
    enabled: Boolean(token),
    refetchInterval: POLL_MS,
  });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 animate-rise">
        <PageHeader
          eyebrow="Deals"
          title="My deals"
          description="Every deal where you are the seller, buyer, or mediator, most recently updated first."
          actions={
            token ? (
              <ButtonLink href="/deals/new" leading={<Plus className="size-4" />}>
                New deal
              </ButtonLink>
            ) : null
          }
        />

        {!token ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="Sign in to see your deals"
            description="Your deals are only visible to the identities that are party to them."
            action={
              <ButtonLink href="/onboarding?next=/deals" size="sm">
                Sign in
              </ButtonLink>
            }
          />
        ) : dealsQuery.isPending ? (
          <ul className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your deals">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex flex-col gap-3 rounded-2xl border border-line bg-glass p-5">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        ) : dealsQuery.isError ? (
          <Alert tone="danger" title="Could not load your deals">
            {dealsQuery.error instanceof Error ? dealsQuery.error.message : "Try again in a moment."}
          </Alert>
        ) : dealsQuery.data.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="No deals yet"
            description="Create a deal as the seller, or ask a seller to add your public key as the buyer."
            action={
              <ButtonLink href="/deals/new" size="sm">
                Create a deal
              </ButtonLink>
            }
          />
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
        className="group flex flex-col gap-4 rounded-2xl border border-line bg-glass p-5 backdrop-blur-md transition-[border-color,box-shadow] hover:border-violet/50 hover:shadow-glow-violet sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-words font-display font-semibold text-ink">{deal.title}</span>
            <StatusBadge status={deal.status} />
          </div>
          <span className="font-mono text-[11px] text-ink-subtle">
            {deal.id.slice(0, 16)}… · updated {new Date(deal.updated_at).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">you: {deal.role}</Badge>
            <Badge>{deal.network}</Badge>
          </div>
          <Amount sats={deal.amount_sats} size="sm" showBtc={false} />
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
          />
        </div>
      </Link>
    </li>
  );
}
