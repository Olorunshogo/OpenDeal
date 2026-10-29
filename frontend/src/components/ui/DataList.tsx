import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface DataListItem {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

export interface DataListProps {
  items: DataListItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}

// === Classes

const DATA_LIST_COLUMNS: Record<NonNullable<DataListProps["columns"]>, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
};

// === Component

export function DataList({ items, columns = 2, className }: DataListProps): React.JSX.Element {
  return (
    <dl className={cn("grid grid-cols-1 gap-4", DATA_LIST_COLUMNS[columns], className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("flex min-w-0 flex-col gap-1", item.wide && "sm:col-span-full")}>
          <dt className="text-xs uppercase tracking-[0.12em] text-ink-subtle">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
