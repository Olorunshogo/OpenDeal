// === Types

export interface ShellStateOptions {
  error?: boolean;
  disabled?: boolean;
}

// === Classes

/* Shared border/background/focus box every text input and textarea sits in, so a focus-state fix lands once. */
const SHELL_BASE =
  "w-full rounded border bg-[var(--bg-lift)]/50 px-3 py-2 text-[var(--ink)] outline-none transition-colors duration-200 placeholder:text-[var(--ink-muted)]/60";

export function fieldShellClass(options: ShellStateOptions = {}, className = ""): string {
  const { error, disabled } = options;

  const state = error
    ? "border-[var(--danger)]"
    : disabled
      ? "border-[var(--line)] opacity-50 cursor-not-allowed"
      : "border-[var(--line)] hover:border-[var(--accent)]/60 focus:border-[var(--accent)]";

  return `${SHELL_BASE} ${state} ${className}`.trim();
}
