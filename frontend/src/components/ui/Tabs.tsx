"use client";

import { motion } from "framer-motion";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { springPanel } from "@/lib/motion";

// === Types

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  content: ReactNode;
}

export interface TabsProps<T extends string = string> {
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

// === Component

export function Tabs<T extends string = string>({
  label,
  tabs,
  value,
  onChange,
  className,
}: TabsProps<T>): React.JSX.Element {
  const baseId: string = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const active: TabItem<T> | undefined = tabs.find((tab) => tab.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current: number = tabs.findIndex((tab) => tab.value === value);
    const targets: Record<string, number> = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next: number | undefined = targets[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    onChange(tabs[next].value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${tabs[next].value}"]`)?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((tab) => {
          const selected: boolean = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.value}`}
              tabIndex={selected ? 0 : -1}
              data-value={tab.value}
              onClick={() => onChange(tab.value)}
              className={cn(
                "relative cursor-pointer px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                selected ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {tab.label}
              {selected ? (
                <motion.span
                  layoutId={`${baseId}-indicator`}
                  transition={springPanel}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {active ? (
        <div role="tabpanel" id={`${baseId}-panel-${active.value}`} aria-labelledby={`${baseId}-tab-${active.value}`}>
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
