"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import BlurText from "@/components/react-bits/BlurText";
import CountUp from "@/components/react-bits/CountUp";
import ShinyText from "@/components/react-bits/ShinyText";
import StarBorder from "@/components/react-bits/StarBorder";
import { ButtonLink } from "@/components/ui";
import { HERO, STATS } from "@/app/content";
import { HeroBackdrop } from "./HeroBackdrop";

// === Component

export function Hero(): React.JSX.Element {
  return (
    <section className="relative isolate flex min-h-[calc(100dvh-4rem)] items-center overflow-hidden px-4 py-20 sm:px-6 lg:px-12">
      <HeroBackdrop />
      <div className="relative flex w-full max-w-3xl flex-col gap-10">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-glass px-3 py-1 text-xs uppercase tracking-[0.18em] backdrop-blur-sm">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand shadow-glow-brand" />
            <ShinyText text={HERO.badge} color="#A39FA9" shineColor="#FDBA74" speed={3} />
          </span>
          <h1 className="sr-only">
            {HERO.headline} {HERO.highlight}
          </h1>
          <div
            aria-hidden="true"
            className="flex flex-col font-display text-4xl leading-[1.05] font-semibold tracking-tight text-ink sm:text-6xl lg:text-7xl"
          >
            <BlurText text={HERO.headline} animateBy="words" trigger="load" delay={90} />
            <BlurText
              text={HERO.highlight}
              animateBy="words"
              trigger="load"
              delay={90}
              className="bg-linear-to-r from-brand via-brand-soft to-violet-soft bg-clip-text text-transparent"
              color="transparent"
            />
          </div>
          <p className="max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl">{HERO.body}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <StarBorder
            as={Link}
            href={HERO.primaryCta.href}
            color="#F7931A"
            radius={999}
            backgroundColor="#F7931A"
            textColor="#1A0F02"
            borderColor="rgba(247, 147, 26, 0.45)"
            className="font-semibold"
          >
            {HERO.primaryCta.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </StarBorder>
          <ButtonLink href={HERO.secondaryCta.href} variant="secondary" size="lg">
            {HERO.secondaryCta.label}
          </ButtonLink>
        </div>

        <dl className="grid max-w-2xl grid-cols-1 gap-6 border-t border-line pt-8 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1">
              <dt className="order-2 text-sm text-ink-muted">{stat.label}</dt>
              <dd className="order-1 font-display text-3xl font-semibold text-ink">
                <CountUp
                  to={Math.max(stat.value, stat.from)}
                  from={Math.min(stat.value, stat.from)}
                  direction={stat.from > stat.value ? "down" : "up"}
                  duration={1.6}
                  suffix={stat.suffix}
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
