import { Suspense } from "react";
import { PageFallback } from "@/components/layout/PageFallback";
import { NewDealClient } from "./NewDealClient";

export default function NewDealPage() {
  return (
    <Suspense
      fallback={<PageFallback label="Loading…" />}
    >
      <NewDealClient />
    </Suspense>
  );
}
