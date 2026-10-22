import Image from "next/image";
import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { SessionBar } from "@/components/SessionBar";
import { Hero } from "@/components/home/Hero";
import { TrustGrid } from "@/components/home/TrustGrid";
import { HowItWorks } from "@/components/home/HowItWorks";
import { AudienceSplit } from "@/components/home/AudienceSplit";
import { FinalCta } from "@/components/home/FinalCta";

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex items-center justify-between px-6 py-5 md:px-12">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image
              src="/logo-tr.png"
              alt=""
              width={28}
              height={33}
              className="h-7 w-auto"
              priority
            />
            <Image
              src="/full-logo-tr.png"
              alt="OpenDeal"
              width={160}
              height={56}
              className="h-8 w-auto md:h-9"
              priority
            />
          </Link>
          <nav className="flex gap-5 text-sm text-[var(--ink-muted)]">
            <Link href="/deals/new" className="hover:text-[var(--ink)]">
              New deal
            </Link>
            <Link href="/market" className="hover:text-[var(--ink)]">
              Market
            </Link>
            <Link href="/mediator" className="hover:text-[var(--ink)]">
              Mediator
            </Link>
          </nav>
        </header>

        <Hero />
        <TrustGrid />
        <HowItWorks />
        <AudienceSplit />
        <FinalCta />

        <footer className="border-t border-[var(--line)] px-6 py-6 md:px-12">
          <SessionBar />
        </footer>
      </div>
    </MotionConfig>
  );
}
