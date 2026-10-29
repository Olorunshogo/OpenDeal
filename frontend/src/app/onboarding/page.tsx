import { Suspense } from "react";
import { PageFallback } from "@/components/layout/PageFallback";
import { OnboardingClient } from "./OnboardingClient";

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={<PageFallback label="Loading…" />}
    >
      <OnboardingClient />
    </Suspense>
  );
}
