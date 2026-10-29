import { RevealOnView } from "@/components/motion/RevealOnView";
import { STEPS, STEPS_INTRO } from "@/app/content";
import { SectionHeading } from "./SectionHeading";

// === Component

export function HowItWorks(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:px-12">
      <SectionHeading intro={STEPS_INTRO} />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <RevealOnView
                index={index + 1}
                className="relative flex h-full flex-col gap-4 overflow-hidden rounded-3xl border border-line bg-glass p-6"
              >
                <span
                  aria-hidden="true"
                  className="absolute -top-6 -right-2 font-display text-8xl font-bold text-violet/10 select-none"
                >
                  {index + 1}
                </span>
                <span className="flex items-center gap-2 text-violet-soft">
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.6} />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                    Step {index + 1}
                  </span>
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold text-ink">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-muted">{step.body}</p>
                </div>
              </RevealOnView>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
