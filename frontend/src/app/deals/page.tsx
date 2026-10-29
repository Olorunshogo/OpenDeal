import { Suspense } from "react";
import { MyDealsClient } from "./MyDealsClient";

export default function MyDealsPage() {
  return (
    <Suspense
      fallback={<div className="px-4 py-12 text-[var(--ink-muted)] sm:px-6 lg:px-12">Loading…</div>}
    >
      <MyDealsClient />
    </Suspense>
  );
}
