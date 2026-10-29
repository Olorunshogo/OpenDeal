import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export type CardTone = "glass" | "solid" | "brand" | "violet";

export interface CardProps extends ComponentPropsWithRef<"div"> {
  tone?: CardTone;
  padded?: boolean;
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

// === Classes

const CARD_TONE: Record<CardTone, string> = {
  glass: "border-line bg-glass backdrop-blur-md",
  solid: "border-line bg-surface",
  brand: "border-brand/30 bg-brand/[0.06] shadow-glow-brand",
  violet: "border-violet/30 bg-violet-deep/10 shadow-glow-violet",
};

// === Components

export function Card({ tone = "glass", padded = true, className, ...rest }: CardProps): React.JSX.Element {
  return (
    <div
      className={cn("flex flex-col gap-4 rounded-2xl border", CARD_TONE[tone], padded && "p-5 sm:p-6", className)}
      {...rest}
    />
  );
}

export function CardHeader({ title, description, action, className }: CardHeaderProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
