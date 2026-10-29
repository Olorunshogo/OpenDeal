"use client";

import { motion } from "framer-motion";
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { springPanel } from "@/lib/motion";

// === Types

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string = string> {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hideLabel?: boolean;
  fullWidth?: boolean;
  className?: string;
}

// === Component

export function SegmentedControl<T extends string = string>({
  label,
  options,
  value,
  onChange,
  hideLabel = false,
  fullWidth = false,
  className,
}: SegmentedControlProps<T>): React.JSX.Element {
  const labelId: string = useId();
  const indicatorId: string = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step: number = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const current: number = options.findIndex((option) => option.value === value);
    const next: SegmentOption<T> = options[(current + step + options.length) % options.length];
    onChange(next.value);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={labelId} className={hideLabel ? "sr-only" : "text-sm font-medium text-ink"}>
        {label}
      </span>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className={cn(
          "relative grid auto-cols-fr grid-flow-col gap-1 rounded-full border border-line bg-glass p-1",
          fullWidth ? "w-full" : "w-fit",
        )}
      >
        {options.map((option) => {
          const selected: boolean = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                selected ? "text-brand-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId={indicatorId}
                  transition={springPanel}
                  className="absolute inset-0 rounded-full bg-brand"
                />
              ) : null}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
