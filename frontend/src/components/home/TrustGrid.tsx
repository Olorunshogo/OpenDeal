"use client";

import { motion } from "framer-motion";
import { Eye, KeyRound, ShieldAlert, SplitSquareVertical, type LucideIcon } from "lucide-react";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Types

interface TrustPoint {
  icon: LucideIcon;
  title: string;
  body: string;
}

// === Data

const POINTS: TrustPoint[] = [
  {
    icon: KeyRound,
    title: "Your keys, your signature",
    body: "Agreement signing and PSBT signing both happen with a local secp256k1 secret. It never touches the API.",
  },
  {
    icon: SplitSquareVertical,
    title: "2-of-3, enforced on-chain",
    body: "Buyer, seller, mediator. Any two of the three signatures move the escrow — never one, never the API alone.",
  },
  {
    icon: Eye,
    title: "Review before you sign",
    body: "The PSBT panel decodes outputs, destination, and fee before finalize is even enabled.",
  },
  {
    icon: ShieldAlert,
    title: "Honest about what's missing",
    body: "Regtest experimental. No external security review of the Bitcoin crate yet — that gate blocks mainnet until one exists.",
  },
];

// === Component

export function TrustGrid(): React.JSX.Element {
  return (
    <section className="border-y border-[var(--line)] bg-[var(--bg-mid)]/40 px-6 py-20 md:px-12 md:py-24">
      <motion.p
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={fadeUpVariants}
        transition={staggerDelay(0)}
        className="text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]"
      >
        Why trust the escrow
      </motion.p>

      <div className="mt-10 grid gap-x-8 gap-y-10 md:grid-cols-2">
        {POINTS.map((point, index) => {
          const Icon = point.icon;
          return (
            <motion.div
              key={point.title}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true, margin: "-80px" }}
              variants={fadeUpVariants}
              transition={staggerDelay(index + 1)}
              className="flex gap-4"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" strokeWidth={1.5} />
              <div>
                <h3 className="font-semibold">{point.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-muted)]">{point.body}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
