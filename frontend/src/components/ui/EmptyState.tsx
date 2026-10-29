import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

// === Component

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-violet/10 text-violet-soft">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-display font-semibold text-ink">{title}</p>
        {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
