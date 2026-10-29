"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { backdropVariants, dialogVariants, sheetVariants, springPanel, transitionFast } from "@/lib/motion";
import { IconButton } from "./IconButton";

// === Types

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}

// === Hooks

const DESKTOP_QUERY: string = "(min-width: 1024px)";

function subscribeToDesktop(onChange: () => void): () => void {
  const query: MediaQueryList = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function subscribeToNothing(): () => void {
  return () => {};
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

// === Classes

const DIALOG_SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "lg:max-w-sm",
  md: "lg:max-w-lg",
  lg: "lg:max-w-2xl",
};

const FOCUSABLE: string =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// === Component

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: DialogProps): React.JSX.Element | null {
  const titleId: string = useId();
  const descriptionId: string = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isDesktop: boolean = useIsDesktop();
  const mounted: boolean = useIsClient();

  useEffect(() => {
    if (!open) {
      return;
    }
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow: string = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame: number = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }
    const focusable: HTMLElement[] = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      return;
    }
    const first: HTMLElement = focusable[0];
    const last: HTMLElement = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!mounted) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transitionFast}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-40 cursor-pointer bg-canvas-deep/70 backdrop-blur-sm"
          />
          <div
            key="panel-wrapper"
            className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6"
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descriptionId : undefined}
              onKeyDown={onKeyDown}
              variants={isDesktop ? dialogVariants : sheetVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={springPanel}
              className={cn(
                "pointer-events-auto flex max-h-[90dvh] w-full flex-col gap-5 overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-glow-violet sm:p-6 lg:rounded-3xl",
                DIALOG_SIZE[size],
              )}
            >
              <span aria-hidden="true" className="mx-auto h-1 w-10 shrink-0 rounded-full bg-line-strong lg:hidden" />
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
                    {title}
                  </h2>
                  {description ? (
                    <p id={descriptionId} className="text-sm text-ink-muted">
                      {description}
                    </p>
                  ) : null}
                </div>
                <IconButton label="Close" size="sm" icon={<X className="size-4" />} onClick={onClose} />
              </div>
              {children ? <div className="flex flex-col gap-4">{children}</div> : null}
              {footer ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
              ) : null}
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
