import { Suspense } from "react";
import { PageFallback } from "@/components/layout/PageFallback";
import { MyDealsClient } from "./MyDealsClient";

export default function MyDealsPage() {
  return (
    <Suspense
      fallback={<PageFallback label="Loading…" />}
    >
      <MyDealsClient />
    </Suspense>
  );
}
