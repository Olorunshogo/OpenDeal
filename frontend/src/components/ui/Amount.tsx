import { cn } from "@/lib/cn";

// === Types

export interface AmountProps {
  sats: number;
  showBtc?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

// === Helpers

export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8);
}

// === Classes

const AMOUNT_SIZE: Record<NonNullable<AmountProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "font-display text-2xl font-semibold sm:text-3xl",
};

// === Component

export function Amount({ sats, showBtc = true, size = "md", className }: AmountProps): React.JSX.Element {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("text-ink tabular-nums", AMOUNT_SIZE[size])}>
        {sats.toLocaleString()} <span className="text-brand">sats</span>
      </span>
      {showBtc ? <span className="font-mono text-xs text-ink-subtle">{satsToBtc(sats)} BTC</span> : null}
    </span>
  );
}
