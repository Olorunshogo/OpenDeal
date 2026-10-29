"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { menuVariants, transitionFast } from "@/lib/motion";
import { Field } from "./Field";
import { INPUT_CONTROL_CLASS, inputShellClass } from "./shell";
import type { SelectOption } from "./Select";

// === Types

export interface ComboboxProps {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  allowCustomValue?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  mono?: boolean;
  fieldClassName?: string;
}

// === Helpers

function matchesQuery(option: SelectOption, query: string): boolean {
  const needle: string = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [option.label, option.value, option.description ?? ""].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

// === Component

export function Combobox({
  label,
  options,
  value,
  onChange,
  allowCustomValue = false,
  placeholder = "Search",
  emptyMessage = "No matches",
  error,
  hint,
  required = false,
  disabled = false,
  mono = false,
  fieldClassName,
}: ComboboxProps): React.JSX.Element {
  const baseId: string = useId();
  const inputId: string = `${baseId}-input`;
  const listboxId: string = `${baseId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLabel: string = options.find((option) => option.value === value)?.label ?? value;
  const [query, setQuery] = useState<string>(selectedLabel);
  const [open, setOpen] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [syncedLabel, setSyncedLabel] = useState<string>(selectedLabel);

  if (syncedLabel !== selectedLabel) {
    setSyncedLabel(selectedLabel);
    setQuery(selectedLabel);
  }

  const filtered: SelectOption[] = useMemo<SelectOption[]>(
    () => options.filter((option) => !option.disabled && matchesQuery(option, query === selectedLabel ? "" : query)),
    [options, query, selectedLabel],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selectedLabel);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, selectedLabel]);

  function choose(option: SelectOption | undefined): void {
    if (!option) {
      return;
    }
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  function onInputChange(next: string): void {
    setQuery(next);
    setOpen(true);
    setActiveIndex(0);
    if (allowCustomValue) {
      onChange(next.trim());
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Enter":
        if (open && filtered[activeIndex]) {
          event.preventDefault();
          choose(filtered[activeIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        setQuery(selectedLabel);
        break;
      default:
        break;
    }
  }

  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      htmlFor={inputId}
      className={fieldClassName}
    >
      <div ref={containerRef} className="relative">
        <span className={inputShellClass({ error, disabled, active: open })}>
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
          <input
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && filtered[activeIndex] ? `${baseId}-option-${activeIndex}` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            required={required}
            disabled={disabled}
            placeholder={placeholder}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onKeyDown}
            className={cn(INPUT_CONTROL_CLASS, mono && "font-mono text-xs")}
          />
        </span>
        <AnimatePresence>
          {open ? (
            <motion.ul
              id={listboxId}
              role="listbox"
              variants={menuVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionFast}
              className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-50 flex max-h-64 flex-col gap-0.5 overflow-auto rounded-2xl border border-line bg-elevated p-1.5 shadow-glow-violet"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-ink-subtle">
                  {allowCustomValue && query.trim() ? `Use "${query.trim()}"` : emptyMessage}
                </li>
              ) : null}
              {filtered.map((option, index) => (
                <li
                  key={option.value}
                  id={`${baseId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  onPointerEnter={() => setActiveIndex(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex cursor-pointer items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                    index === activeIndex && "bg-violet/15",
                    option.value === value ? "text-ink" : "text-ink-muted",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="truncate font-mono text-xs text-ink-subtle">{option.description}</span>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                  ) : null}
                </li>
              ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
    </Field>
  );
}
