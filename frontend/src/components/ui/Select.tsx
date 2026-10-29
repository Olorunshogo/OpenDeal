"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { menuVariants, transitionFast } from "@/lib/motion";
import { Field } from "./Field";
import { inputShellClass } from "./shell";

// === Types

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  label: string;
  options: SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  hideLabel?: boolean;
  name?: string;
  fieldClassName?: string;
}

// === Helpers

function nextEnabledIndex<T extends string>(options: SelectOption<T>[], from: number, step: 1 | -1): number {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (from + step * offset + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
  }
  return from;
}

// === Component

export function Select<T extends string = string>({
  label,
  options,
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  required = false,
  disabled = false,
  hideLabel = false,
  name,
  fieldClassName,
}: SelectProps<T>): React.JSX.Element {
  const baseId: string = useId();
  const triggerId: string = `${baseId}-trigger`;
  const listboxId: string = `${baseId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const selectedIndex: number = options.findIndex((option) => option.value === value);
  const selected: SelectOption<T> | undefined = options[selectedIndex];

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex]);

  function openMenu(): void {
    if (disabled) {
      return;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(options, -1, 1));
    setOpen(true);
  }

  function choose(index: number): void {
    const option: SelectOption<T> | undefined = options[index];
    if (!option || option.disabled) {
      return;
    }
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => nextEnabledIndex(options, index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => nextEnabledIndex(options, index, -1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(options, -1, 1));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(nextEnabledIndex(options, options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (event.key.length === 1) {
          const letter: string = event.key.toLowerCase();
          const match: number = options.findIndex(
            (option) => !option.disabled && option.label.toLowerCase().startsWith(letter),
          );
          if (match >= 0) {
            setActiveIndex(match);
          }
        }
    }
  }

  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      hideLabel={hideLabel}
      htmlFor={triggerId}
      className={fieldClassName}
    >
      <div ref={containerRef} className="relative">
        <button
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-option-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className={inputShellClass({
            error,
            disabled,
            active: open,
            className: "cursor-pointer justify-between text-left",
          })}
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-ink-subtle")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 shrink-0 text-ink-muted transition-transform duration-200", open && "rotate-180")}
          />
        </button>
        {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
        <AnimatePresence>
          {open ? (
            <motion.ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={triggerId}
              variants={menuVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transitionFast}
              className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-50 flex max-h-64 origin-top flex-col gap-0.5 overflow-auto rounded-2xl border border-line bg-elevated p-1.5 shadow-glow-violet"
            >
              {options.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-ink-subtle">No options available</li>
              ) : null}
              {options.map((option, index) => {
                const isSelected: boolean = option.value === value;
                const isActive: boolean = index === activeIndex;
                return (
                  <li
                    key={option.value}
                    id={`${baseId}-option-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onPointerEnter={() => !option.disabled && setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex cursor-pointer items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                      isActive && "bg-violet/15",
                      isSelected ? "text-ink" : "text-ink-muted",
                      option.disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="text-xs text-ink-subtle">{option.description}</span>
                      ) : null}
                    </span>
                    {isSelected ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" /> : null}
                  </li>
                );
              })}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
    </Field>
  );
}
