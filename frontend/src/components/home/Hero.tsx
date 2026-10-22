"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Component

export function Hero(): React.JSX.Element {
  return (
    <main className="relative flex flex-1 flex-col justify-end px-6 pb-16 pt-10 md:px-12 md:pb-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(245,245,240,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(245,245,240,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, black 20%, transparent 85%)",
        }}
      />

      <div className="relative z-10 max-w-3xl">
        <motion.p
          initial="initial"
          animate="animate"
          variants={fadeUpVariants}
          transition={staggerDelay(0)}
          className="network-badge mb-4 text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]"
        >
          Bitcoin coordination · regtest experimental
        </motion.p>
        <motion.h1 initial="initial" animate="animate" variants={fadeUpVariants} transition={staggerDelay(1)}>
          <Image
            src="/full-logo-tr.png"
            alt="OpenDeal"
            width={365}
            height={129}
            className="h-auto w-full max-w-md md:max-w-xl"
            priority
          />
        </motion.h1>
        <motion.p
          initial="initial"
          animate="animate"
          variants={fadeUpVariants}
          transition={staggerDelay(2)}
          className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--ink-muted)] md:text-xl"
        >
          Signed deal agreements. 2-of-3 multisig escrow. The API coordinates the deal; it never
          holds your keys.
        </motion.p>
        <motion.div
          initial="initial"
          animate="animate"
          variants={fadeUpVariants}
          transition={staggerDelay(3)}
          className="mt-8 flex flex-wrap gap-3"
        >
          <Link
            href="/deals/new"
            className="rounded bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)]"
          >
            Start a deal
          </Link>
          <Link
            href="/mediator"
            className="rounded border border-[var(--line)] px-5 py-3 text-sm text-[var(--ink)] transition hover:border-[var(--accent)]"
          >
            Mediator desk
          </Link>
        </motion.div>
      </div>
    </main>
  );
}
