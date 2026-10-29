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

// === Durations

export const motionDuration = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const transitionFast: Transition = {
  duration: motionDuration.fast,
  ease: motionEase,
};

// === Springs

export const springPanel: Transition = {
  type: "spring",
  damping: 28,
  stiffness: 320,
};

export const springPop: Transition = {
  type: "spring",
  damping: 24,
  stiffness: 420,
};

// === Menus and overlays

export const menuVariants: Variants = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.98 },
};

export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const sheetVariants: Variants = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
};

export const dialogVariants: Variants = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.97 },
};
