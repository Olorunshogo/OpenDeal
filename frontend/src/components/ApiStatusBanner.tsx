"use client";

import { useQuery } from "@tanstack/react-query";
import { API_HEALTH_QUERY_KEY, checkApiHealth, type ApiHealth } from "@/lib/api";

// === Hook

function useApiHealth(): ApiHealth | undefined {
  const healthQuery = useQuery({
    queryKey: API_HEALTH_QUERY_KEY,
    queryFn: checkApiHealth,
    retry: false,
    refetchInterval: (query) => (query.state.data === "online" ? false : 10_000),
  });
  return healthQuery.data;
}

// === Components

const STATUS_LABEL: Record<ApiHealth, string> = {
  online: "API online",
  degraded: "API degraded",
  offline: "API offline",
};

const STATUS_DOT_CLASS: Record<ApiHealth, string> = {
  online: "bg-[var(--ok)]",
  degraded: "bg-[var(--warn)]",
  offline: "bg-[var(--danger)]",
};

export function ApiStatusIndicator(): React.JSX.Element {
  const health: ApiHealth | undefined = useApiHealth();
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${health ? STATUS_DOT_CLASS[health] : "bg-[var(--line)]"}`}
      />
      <span className="hidden sm:inline">{health ? STATUS_LABEL[health] : "Checking API"}</span>
    </span>
  );
}

export function ApiStatusBanner(): React.JSX.Element | null {
  const health: ApiHealth | undefined = useApiHealth();
  if (health !== "degraded" && health !== "offline") {
    return null;
  }
  const offline: boolean = health === "offline";
  return (
    <div
      role="alert"
      className={`rounded border px-3 py-2 text-sm ${
        offline
          ? "border-[var(--danger)]/60 bg-[var(--danger)]/10 text-[var(--danger)]"
          : "border-[var(--warn)]/50 bg-[var(--warn)]/10 text-[var(--ink)]"
      }`}
    >
      {offline
        ? "The OpenDeal API is not reachable. Actions will fail until it is back. Retrying every 10 seconds."
        : "The OpenDeal API is up but its database is unavailable. Retrying every 10 seconds."}
    </div>
  );
}
