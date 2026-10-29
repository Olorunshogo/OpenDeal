import { Suspense } from "react";
import { OnboardingClient } from "./OnboardingClient";

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={<div className="px-4 py-12 text-[var(--ink-muted)] sm:px-6 lg:px-12">Loading…</div>}
    >
      <OnboardingClient />
    </Suspense>
  );
}
