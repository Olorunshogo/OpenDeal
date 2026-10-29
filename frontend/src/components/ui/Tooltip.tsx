import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}

// === Component

export function Tooltip({ content, side = "top", className, children }: TooltipProps): React.JSX.Element {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-ink opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.5rem)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}
