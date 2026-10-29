"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui";
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
  online: "bg-ok",
  degraded: "bg-warn",
  offline: "bg-danger",
};

export function ApiStatusIndicator(): React.JSX.Element {
  const health: ApiHealth | undefined = useApiHealth();
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${health ? STATUS_DOT_CLASS[health] : "bg-line-strong"}`}
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
  return health === "offline" ? (
    <Alert tone="danger" title="The OpenDeal API is not reachable">
      Actions will fail until it is back. Retrying every 10 seconds.
    </Alert>
  ) : (
    <Alert tone="warn" title="The OpenDeal API is degraded">
      It is up, but its database is unavailable. Retrying every 10 seconds.
    </Alert>
  );
}
