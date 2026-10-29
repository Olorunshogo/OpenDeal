import { Suspense } from "react";
import { DealDetailClient } from "./DealDetailClient";

export default function DealDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-12 text-[var(--ink-muted)] sm:px-6 lg:px-12">Loading deal…</div>
      }
    >
      <DealDetailClient />
    </Suspense>
  );
}
