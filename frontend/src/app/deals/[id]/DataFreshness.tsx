"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/** "Updated 3s ago" plus a manual refresh, so it is clear the page is current. */
export function DataFreshness({
  updatedAt,
  fetching,
  onRefresh,
}: {
  updatedAt: number;
  fetching: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds: number | null = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-line bg-glass px-4 py-1.5 text-xs text-ink-muted">
      <span aria-live="polite" className="inline-flex items-center gap-2">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", fetching ? "bg-warn" : "bg-ok")} />
        {fetching
          ? "Checking for updates…"
          : seconds === null
            ? "Not loaded yet"
            : `Updated ${seconds}s ago · auto-refreshes every 5s`}
      </span>
      <Button
        variant="link"
        size="sm"
        className="text-xs"
        disabled={fetching}
        leading={<RefreshCw className={cn("size-3", fetching && "animate-spin")} />}
        onClick={onRefresh}
      >
        Refresh
      </Button>
    </div>
  );
}
