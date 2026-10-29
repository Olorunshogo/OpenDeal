import { cn } from "@/lib/cn";
import { CopyButton } from "./CopyButton";

// === Types

export interface HashValueProps {
  value: string;
  head?: number;
  tail?: number;
  full?: boolean;
  copyable?: boolean;
  className?: string;
}

// === Helpers

export function shortenMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

// === Component

export function HashValue({
  value,
  head = 8,
  tail = 6,
  full = false,
  copyable = true,
  className,
}: HashValueProps): React.JSX.Element {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-2", className)}>
      <code title={value} className={cn("min-w-0 font-mono text-xs text-ink", full ? "break-all" : "truncate")}>
        {full ? value : shortenMiddle(value, head, tail)}
      </code>
      {copyable ? <CopyButton value={value} iconOnly variant="ghost" size="sm" label="Copy value" /> : null}
    </span>
  );
}
