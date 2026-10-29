"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { fadeUpVariants, staggerDelay } from "@/lib/motion";

// === Types

export interface RevealOnViewProps {
  index?: number;
  className?: string;
  children: ReactNode;
}

// === Component

export function RevealOnView({ index = 0, className, children }: RevealOnViewProps): React.JSX.Element {
  return (
    <motion.div
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: "-80px" }}
      variants={fadeUpVariants}
      transition={staggerDelay(index)}
      className={className}
    >
      {children}
    </motion.div>
  );
}
