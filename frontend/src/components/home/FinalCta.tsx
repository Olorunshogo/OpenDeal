"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import StarBorder from "@/components/react-bits/StarBorder";
import { RevealOnView } from "@/components/motion/RevealOnView";
import { ButtonLink } from "@/components/ui";
import { FINAL_CTA } from "@/app/content";

// === Component

export function FinalCta(): React.JSX.Element {
  return (
    <section className="px-4 py-20 sm:px-6 sm:py-28 lg:px-12">
      <RevealOnView className="relative isolate flex flex-col items-center gap-8 overflow-hidden rounded-[2rem] border border-violet/30 px-6 py-16 text-center sm:px-12 sm:py-20">
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(75,29,239,0.35),transparent_70%),radial-gradient(40%_60%_at_50%_100%,rgba(247,147,26,0.18),transparent_70%)]"
        />
        <div className="flex flex-col items-center gap-4">
          <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
            {FINAL_CTA.title}
          </h2>
          <p className="max-w-xl text-ink-muted">{FINAL_CTA.body}</p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <StarBorder
            as={Link}
            href={FINAL_CTA.primaryCta.href}
            color="#F7931A"
            radius={999}
            backgroundColor="#F7931A"
            textColor="#1A0F02"
            borderColor="rgba(247, 147, 26, 0.45)"
            className="font-semibold"
          >
            {FINAL_CTA.primaryCta.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </StarBorder>
          <ButtonLink href={FINAL_CTA.secondaryCta.href} variant="secondary" size="lg">
            {FINAL_CTA.secondaryCta.label}
          </ButtonLink>
        </div>
      </RevealOnView>
    </section>
  );
}
