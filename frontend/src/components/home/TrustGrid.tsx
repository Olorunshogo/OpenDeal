"use client";

import SpotlightCard from "@/components/react-bits/SpotlightCard";
import { RevealOnView } from "@/components/motion/RevealOnView";
import { TRUST_INTRO, TRUST_POINTS } from "@/app/content";
import { SectionHeading } from "./SectionHeading";

// === Component

export function TrustGrid(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-12 border-y border-line bg-surface/40 px-4 py-20 sm:px-6 sm:py-28 lg:px-12">
      <SectionHeading intro={TRUST_INTRO} />
      <div className="grid gap-4 sm:grid-cols-2">
        {TRUST_POINTS.map((point, index) => {
          const Icon = point.icon;
          return (
            <RevealOnView key={point.title} index={index + 1} className="h-full">
              <SpotlightCard
                spotlightColor="rgba(139, 92, 246, 0.22)"
                className="flex h-full flex-col gap-4 rounded-3xl border border-line bg-glass p-6 sm:p-8"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 text-brand">
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.6} />
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold text-ink">{point.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-muted">{point.body}</p>
                </div>
              </SpotlightCard>
            </RevealOnView>
          );
        })}
      </div>
    </section>
  );
}
