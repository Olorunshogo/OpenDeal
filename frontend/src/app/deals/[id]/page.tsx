import { Suspense } from "react";
import { DealDetailClient } from "./DealDetailClient";

export default function DealDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="px-6 py-12 text-[var(--ink-muted)] md:px-12">Loading deal…</div>
      }
    >
      <DealDetailClient />
    </Suspense>
  );
}
