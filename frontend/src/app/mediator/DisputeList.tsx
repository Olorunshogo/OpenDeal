"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { Alert, Amount, EmptyState, Skeleton } from "@/components/ui";
import { listDisputes, type OpenDisputeSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

// === Types

export interface DisputeListProps {
  token: string;
  viewer: string | undefined;
  selectedId: string | null;
  onSelect: (dispute: OpenDisputeSummary) => void;
}

// === Hooks

export function useOpenDisputes(token: string, viewer: string | undefined): UseQueryResult<OpenDisputeSummary[]> {
  return useQuery({
    queryKey: ["disputes", "open", viewer],
    queryFn: () => listDisputes(token),
    enabled: Boolean(token),
  });
}

// === Component

export function DisputeList({ token, viewer, selectedId, onSelect }: DisputeListProps): React.JSX.Element {
  const disputesQuery = useOpenDisputes(token, viewer);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs uppercase tracking-[0.14em] text-ink-subtle">Open disputes</p>
      {disputesQuery.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : null}
      {disputesQuery.isError ? (
        <Alert tone="danger" title="Could not load disputes">
          Is your identity an approved mediator?
        </Alert>
      ) : null}
      {disputesQuery.isSuccess && !disputesQuery.data.length ? (
        <EmptyState icon={<Scale className="size-5" />} title="No open disputes" description="New disputes appear here." />
      ) : null}
      <ul className="flex flex-col gap-2">
        {(disputesQuery.data ?? []).map((dispute) => {
          const selected: boolean = selectedId === dispute.id;
          return (
            <li key={dispute.id}>
              <button
                type="button"
                onClick={() => onSelect(dispute)}
                aria-pressed={selected}
                className={cn(
                  "flex w-full cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 text-left text-sm transition-[border-color,box-shadow,background-color]",
                  selected
                    ? "border-violet bg-violet/10 shadow-glow-violet"
                    : "border-line bg-glass hover:border-violet/50",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="break-words font-medium text-ink">{dispute.title}</span>
                  <Amount sats={dispute.amount_sats} size="sm" showBtc={false} className="shrink-0" />
                </span>
                <span className="text-xs text-ink-subtle">opened by {dispute.opened_by.slice(0, 8)}…</span>
                <span className="line-clamp-2 text-xs text-ink-muted">{dispute.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
