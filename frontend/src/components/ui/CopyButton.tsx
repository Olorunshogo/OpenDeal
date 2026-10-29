"use client";

import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./Button";

// === Types

export type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  value: string;
  label?: string;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

// === Component

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  variant = "secondary",
  size = "sm",
  className,
}: CopyButtonProps): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => setCopyState("idle"), 1500);
  }

  const stateLabel: string = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : label;
  const Icon = copyState === "copied" ? Check : copyState === "failed" ? X : Copy;

  return (
    <button
      type="button"
      onClick={onCopy}
      title={value}
      aria-label={iconOnly ? stateLabel : undefined}
      className={cn(
        buttonClass({ variant, size }),
        iconOnly && "aspect-square px-0",
        copyState === "copied" && "text-ok",
        copyState === "failed" && "text-danger",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {iconOnly ? null : stateLabel}
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "idle" ? "" : stateLabel}
      </span>
    </button>
  );
}
