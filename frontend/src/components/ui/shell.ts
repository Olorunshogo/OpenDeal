import { cn } from "@/lib/cn";

// === Types

export type InputShape = "pill" | "box";

export interface InputStateOptions {
  error?: string | boolean;
  disabled?: boolean;
  readOnly?: boolean;
  active?: boolean;
}

export interface InputShellClassOptions extends InputStateOptions {
  shape?: InputShape;
  className?: string;
}

// === Classes

export function inputStateClass(options: InputStateOptions = {}): string {
  const { error, disabled, readOnly, active } = options;
  if (error) {
    return "border-danger/70 focus-within:border-danger";
  }
  if (disabled) {
    return "border-line cursor-not-allowed opacity-50";
  }
  if (readOnly) {
    return "border-line bg-canvas/60 text-ink-muted";
  }
  if (active) {
    return "border-violet shadow-glow-violet";
  }
  return "border-line hover:border-line-strong focus-within:border-violet focus-within:shadow-glow-violet";
}

const SHELL_BASE: string =
  "flex w-full items-center gap-2 border bg-glass text-ink backdrop-blur-sm transition-[border-color,box-shadow] duration-200";

const SHELL_SHAPE: Record<InputShape, string> = {
  pill: "h-11 rounded-full px-4 text-sm",
  box: "items-stretch rounded-2xl px-4 py-3 text-sm",
};

export function inputShellClass(options: InputShellClassOptions = {}): string {
  const { shape = "pill", className, ...state } = options;
  return cn(SHELL_BASE, SHELL_SHAPE[shape], inputStateClass(state), className);
}

export const INPUT_CONTROL_CLASS: string =
  "h-full w-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed read-only:cursor-default focus-visible:outline-none";
