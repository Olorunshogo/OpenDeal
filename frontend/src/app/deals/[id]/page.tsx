import { Suspense } from "react";
import { PageFallback } from "@/components/layout/PageFallback";
import { DealDetailClient } from "./DealDetailClient";

export default function DealDetailPage() {
  return (
    <Suspense
      fallback={<PageFallback label="Loading deal…" />}
    >
      <DealDetailClient />
    </Suspense>
  );
}
