"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useEffect, useState } from "react";
import { API_HEALTH_QUERY_KEY, setApiUnreachableHandler } from "@/lib/api";
import { initBrowserSentry } from "@/lib/sentry";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState<QueryClient>((): QueryClient => new QueryClient());

  useEffect(() => {
    initBrowserSentry();
  }, []);

  useEffect(() => {
    setApiUnreachableHandler(() => {
      void queryClient.invalidateQueries({ queryKey: API_HEALTH_QUERY_KEY });
    });
    return () => setApiUnreachableHandler(null);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
