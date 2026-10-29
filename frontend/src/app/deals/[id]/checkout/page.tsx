import { Suspense } from "react";
import { PageFallback } from "@/components/layout/PageFallback";
import { CheckoutClient } from "./CheckoutClient";

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={<PageFallback label="Loading checkout…" />}
    >
      <CheckoutClient />
    </Suspense>
  );
}
