import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { BadgeTone } from "./Badge";

// === Types

export interface TimelineEntry {
  id: string | number;
  title: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  tone?: BadgeTone;
}

// === Classes

const TIMELINE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-ink-subtle",
  brand: "bg-brand shadow-glow-brand",
  violet: "bg-violet shadow-glow-violet",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

// === Component

export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }): React.JSX.Element {
  return (
    <ol className={cn("flex flex-col gap-5", className)}>
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative grid grid-cols-[1rem_1fr] gap-x-3">
          {index < entries.length - 1 ? (
            <span aria-hidden="true" className="absolute top-4 -bottom-5 left-2 w-px -translate-x-1/2 bg-line" />
          ) : null}
          <span className="flex justify-center">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", TIMELINE_DOT[entry.tone ?? "neutral"])} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm text-ink">{entry.title}</p>
            {entry.meta ? <p className="text-xs text-ink-subtle">{entry.meta}</p> : null}
            {entry.detail ? <div className="min-w-0 text-xs text-ink-muted">{entry.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
