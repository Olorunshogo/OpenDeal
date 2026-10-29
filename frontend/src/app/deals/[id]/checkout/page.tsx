import { Suspense } from "react";
import { CheckoutClient } from "./CheckoutClient";

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-12 text-[var(--ink-muted)] sm:px-6 lg:px-12">Loading checkout…</div>
      }
    >
      <CheckoutClient />
    </Suspense>
  );
}
