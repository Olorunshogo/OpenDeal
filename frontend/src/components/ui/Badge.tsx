import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { DealStatus } from "@/lib/api";

// === Types

export type BadgeTone = "neutral" | "brand" | "violet" | "ok" | "warn" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

// === Classes

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border-line bg-glass text-ink-muted",
  brand: "border-brand/40 bg-brand/10 text-brand-soft",
  violet: "border-violet/40 bg-violet/10 text-violet-soft",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-danger/40 bg-danger/10 text-danger",
};

const DOT_TONE: Record<BadgeTone, string> = {
  neutral: "bg-ink-subtle",
  brand: "bg-brand",
  violet: "bg-violet",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

const DEAL_STATUS_TONE: Record<DealStatus, BadgeTone> = {
  draft: "neutral",
  agreed: "violet",
  awaiting_payment: "warn",
  funded: "brand",
  shipped: "brand",
  accepted: "violet",
  settled: "ok",
  cancelled: "neutral",
  disputed: "danger",
  refunded: "ok",
  expired: "neutral",
};

// === Components

export function Badge({ tone = "neutral", dot = false, className, children }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_TONE[tone])} /> : null}
      {children}
    </span>
  );
}

export function dealStatusTone(status: string): BadgeTone {
  return DEAL_STATUS_TONE[status as DealStatus] ?? "neutral";
}

export function StatusBadge({ status, className }: { status: string; className?: string }): React.JSX.Element {
  return (
    <Badge tone={dealStatusTone(status)} dot className={className}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
