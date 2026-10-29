"use client";

import { motion } from "framer-motion";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Types

interface Audience {
  role: string;
  headline: string;
  body: string;
}

// === Data

const AUDIENCES: Audience[] = [
  {
    role: "Seller",
    headline: "Get paid without trusting a platform",
    body: "Propose terms, get the buyer's signature, and ship once the escrow is funded and confirmed. Payout is a 2-of-3 settlement you can inspect before you sign.",
  },
  {
    role: "Buyer",
    headline: "Pay into escrow, not into a stranger",
    body: "Your funds sit in a 2-of-3 address until you accept delivery. If something goes wrong, a mediator can weigh in, but still can't move coins alone.",
  },
  {
    role: "Mediator",
    headline: "Decide the outcome, not the custody",
    body: "A mediator's ruling recommends release or refund. The actual Bitcoin still needs two real signatures. The role carries judgment, not unilateral power.",
  },
];

// === Component

export function AudienceSplit(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:px-12">
      <motion.p
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: "-80px" }}
        variants={fadeUpVariants}
        transition={staggerDelay(0)}
        className="text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]"
      >
        Who it&apos;s for
      </motion.p>

      <div className="grid gap-6 lg:grid-cols-3">
        {AUDIENCES.map((audience, index) => (
          <motion.div
            key={audience.role}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-80px" }}
            variants={fadeUpVariants}
            transition={staggerDelay(index + 1)}
            className="flex flex-col gap-3 rounded-lg border border-[var(--line)] p-6"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
              {audience.role}
            </span>
            <h3 className="text-xl font-semibold leading-snug">{audience.headline}</h3>
            <p className="text-sm leading-relaxed text-[var(--ink-muted)]">{audience.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
