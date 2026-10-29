import { RevealOnView } from "@/components/motion/RevealOnView";
import type { SectionIntro } from "@/app/content";

export function SectionHeading({ intro }: { intro: SectionIntro }): React.JSX.Element {
  return (
    <RevealOnView className="flex max-w-2xl flex-col gap-3">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-soft">{intro.eyebrow}</p>
      <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{intro.title}</h2>
    </RevealOnView>
  );
}
