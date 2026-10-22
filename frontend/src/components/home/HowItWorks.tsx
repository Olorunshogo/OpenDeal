"use client";

import { motion } from "framer-motion";
import { FileSignature, Lock, PackageCheck, ShieldQuestion, type LucideIcon } from "lucide-react";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Types

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

// === Data

const STEPS: Step[] = [
  {
    icon: FileSignature,
    title: "Agree",
    body: "Seller proposes title, amount, and a buyer and mediator pubkey. Both parties sign the same canonical agreement — the hash of it becomes the deal's receipt chain.",
  },
  {
    icon: Lock,
    title: "Fund escrow",
    body: "The three pubkeys build a 2-of-3 P2WSH address off-chain. Funds move on-chain; the API coordinates state, it never holds a key.",
  },
  {
    icon: PackageCheck,
    title: "Deliver, then release",
    body: "Seller ships, buyer accepts. Either party proposes a settlement PSBT — reviewed line by line before anyone signs.",
  },
  {
    icon: ShieldQuestion,
    title: "Dispute, if needed",
    body: "A mediator's decision updates recommended payout. It still takes two of the three signatures to actually move the Bitcoin.",
  },
];

// === Component

export function HowItWorks(): React.JSX.Element {
  return (
    <section className="px-6 py-20 md:px-12 md:py-28">
      <motion.p
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={fadeUpVariants}
        transition={staggerDelay(0)}
        className="text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]"
      >
        How it works
      </motion.p>
      <motion.h2
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={fadeUpVariants}
        transition={staggerDelay(1)}
        className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-3xl md:text-4xl"
      >
        Four steps. No step gives the API your keys.
      </motion.h2>

      <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.title}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUpVariants}
              transition={staggerDelay(index + 2)}
              className="rounded-lg border border-[var(--line)] bg-[var(--bg-lift)]/40 p-5"
            >
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <Icon className="h-5 w-5" strokeWidth={1.5} />
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                  Step {index + 1}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{step.body}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
