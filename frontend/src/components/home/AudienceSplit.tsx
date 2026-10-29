import { RevealOnView } from "@/components/motion/RevealOnView";
import { AUDIENCES, AUDIENCE_INTRO } from "@/app/content";
import { cn } from "@/lib/cn";
import { SectionHeading } from "./SectionHeading";

// === Classes

const AUDIENCE_ACCENT: string[] = [
  "border-brand/30 bg-linear-to-b from-brand/[0.08] to-transparent",
  "border-violet/30 bg-linear-to-b from-violet/[0.10] to-transparent",
  "border-line bg-linear-to-b from-violet-soft/[0.06] to-transparent",
];

const AUDIENCE_ROLE: string[] = ["text-brand", "text-violet-soft", "text-ink"];

// === Component

export function AudienceSplit(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:px-12">
      <SectionHeading intro={AUDIENCE_INTRO} />
      <div className="grid gap-4 lg:grid-cols-3">
        {AUDIENCES.map((audience, index) => (
          <RevealOnView
            key={audience.role}
            index={index + 1}
            className={cn("flex flex-col gap-3 rounded-3xl border p-6 sm:p-8", AUDIENCE_ACCENT[index])}
          >
            <span className={cn("text-xs font-semibold uppercase tracking-[0.14em]", AUDIENCE_ROLE[index])}>
              {audience.role}
            </span>
            <h3 className="font-display text-xl font-semibold leading-snug text-ink">{audience.headline}</h3>
            <p className="text-sm leading-relaxed text-ink-muted">{audience.body}</p>
          </RevealOnView>
        ))}
      </div>
    </section>
  );
}
