"use client";

import { motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { springPop } from "@/lib/motion";

// === Types

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

// === Component

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className,
}: SwitchProps): React.JSX.Element {
  const labelId: string = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span id={labelId} className="text-ink">
          {label}
        </span>
        {description ? <span className="text-xs text-ink-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "justify-end border-brand bg-brand" : "justify-start border-line-strong bg-glass",
        )}
      >
        <motion.span
          layout
          transition={springPop}
          className={cn("size-4.5 rounded-full", checked ? "bg-brand-ink" : "bg-ink-muted")}
        />
      </button>
    </div>
  );
}
