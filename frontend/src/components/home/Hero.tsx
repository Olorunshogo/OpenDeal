"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Component

export function Hero(): React.JSX.Element {
  return (
    <main className="relative flex flex-1 flex-col justify-end px-4 pb-16 pt-10 sm:px-6 sm:pb-24 lg:px-12">
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

      <div className="relative z-10 flex max-w-3xl flex-col gap-8">
        <div className="flex flex-col gap-5">
          <motion.p
            initial="initial"
            animate="animate"
            variants={fadeUpVariants}
            transition={staggerDelay(0)}
            className="network-badge text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]"
          >
            Bitcoin coordination · regtest experimental
          </motion.p>
          <motion.h1 initial="initial" animate="animate" variants={fadeUpVariants} transition={staggerDelay(1)}>
            <Image
              src="/full-logo-tr.png"
              alt="OpenDeal"
              width={365}
              height={129}
              className="h-auto w-full max-w-md sm:max-w-xl"
              priority
            />
          </motion.h1>
          <motion.p
            initial="initial"
            animate="animate"
            variants={fadeUpVariants}
            transition={staggerDelay(2)}
            className="max-w-xl text-lg leading-relaxed text-[var(--ink-muted)] sm:text-xl"
          >
            Signed deal agreements. 2-of-3 multisig escrow. The API coordinates the deal; it never
            holds your keys.
          </motion.p>
        </div>
        <motion.div
          initial="initial"
          animate="animate"
          variants={fadeUpVariants}
          transition={staggerDelay(3)}
          className="flex flex-wrap gap-3"
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
