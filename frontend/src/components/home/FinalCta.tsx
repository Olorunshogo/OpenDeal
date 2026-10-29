"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUpVariants, transitionSlow } from "@/lib/motion";

// === Component

export function FinalCta(): React.JSX.Element {
  return (
    <motion.section
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: "-80px" }}
      variants={fadeUpVariants}
      transition={transitionSlow}
      className="flex flex-col items-center gap-8 border-t border-[var(--line)] px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-12"
    >
      <div className="flex flex-col items-center gap-4">
        <h2 className="max-w-2xl font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
          Start a deal where the agreement is the contract.
        </h2>
        <p className="max-w-xl text-[var(--ink-muted)]">
          Regtest experimental. Bring a buyer and a mediator pubkey, or open the mediator desk to see
          the other side of a dispute.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/deals/new"
          className="rounded bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)]"
        >
          Start a deal
        </Link>
        <Link
          href="/market"
          className="rounded border border-[var(--line)] px-6 py-3 text-sm text-[var(--ink)] transition hover:border-[var(--accent)]"
        >
          Browse the market
        </Link>
      </div>
    </motion.section>
  );
}
