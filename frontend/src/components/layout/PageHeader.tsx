import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface PageHeaderProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

// === Component

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-soft">{eyebrow}</p>
        <h1 className="break-words font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-ink-muted sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
