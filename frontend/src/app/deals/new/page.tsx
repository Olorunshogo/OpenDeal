import { Suspense } from "react";
import { NewDealClient } from "./NewDealClient";

export default function NewDealPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-12 text-[var(--ink-muted)] sm:px-6 lg:px-12">Loading…</div>
      }
    >
      <NewDealClient />
    </Suspense>
  );
}
