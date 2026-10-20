"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { initBrowserSentry } from "@/lib/sentry";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState<QueryClient>((): QueryClient => new QueryClient());

  useEffect(() => {
    initBrowserSentry();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
