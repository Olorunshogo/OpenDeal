import type { Transition, Variants } from "framer-motion";

/*
 * Single source of truth for motion on marketing/content pages.
 * Import from here instead of writing a one-off variants object in a component,
 * so the whole site accelerates and settles the same way.
 */

// === Timing tokens

export const motionEase = [0.22, 1, 0.36, 1] as const;

export const transitionBase: Transition = {
  duration: 0.5,
  ease: motionEase,
};

/** Larger surfaces entering: hero blocks, section headings. */
export const transitionSlow: Transition = {
  duration: 0.7,
  ease: motionEase,
};

// === Fades

export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

/** Fade plus a short rise. Default entrance for content blocks and cards. */
export const fadeUpVariants: Variants = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
};

// === Staggered groups

/** Per-item delay for a staggered grid or list entrance. */
export function staggerDelay(index: number, step = 0.1): Transition {
  return {
    ...transitionSlow,
    delay: index * step,
  };
}
