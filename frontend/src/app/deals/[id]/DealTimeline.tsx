"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, Skeleton, Timeline, type BadgeTone, type TimelineEntry } from "@/components/ui";
import { getEvents, type DealEvent } from "@/lib/api";

// === Helpers

function eventTone(kind: string): BadgeTone {
  if (/settled|confirmed|signed/.test(kind)) return "ok";
  if (/dispute/.test(kind)) return "danger";
  if (/fund|settlement|broadcast/.test(kind)) return "brand";
  return "violet";
}

// === Component

export function DealTimeline({ token, viewer, dealId }: { token: string; viewer: string | undefined; dealId: string }) {
  const eventsQuery = useQuery({
    queryKey: ["events", dealId, viewer],
    queryFn: () => getEvents(token, dealId),
    enabled: Boolean(dealId && token),
  });
  const entries: TimelineEntry[] = (eventsQuery.data ?? []).map((event: DealEvent) => ({
    id: event.sequence,
    title: `#${event.sequence} · ${String(event.kind)}`,
    meta: new Date(event.created_at).toLocaleString(),
    detail: <span className="font-mono">{event.actor_pubkey.slice(0, 16)}…</span>,
    tone: eventTone(String(event.kind)),
  }));
  return (
    <Card tone="solid" className="lg:sticky lg:top-24">
      <CardHeader title="Timeline" description="Every state change, hash-chained into the receipt." />
      {eventsQuery.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ) : entries.length ? (
        <Timeline entries={entries} />
      ) : (
        <p className="text-sm text-ink-subtle">No events yet.</p>
      )}
    </Card>
  );
}
