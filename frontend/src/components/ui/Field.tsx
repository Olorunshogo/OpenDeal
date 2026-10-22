import type { ReactNode } from "react";

// === Types

export interface FieldProps {
  label: string;
  error?: string;
  required?: boolean;
  /** Keeps the label in the accessibility tree but hides it visually, for compact rows where a placeholder already states the field's purpose. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

// === Component

export function Field({
  label,
  error,
  required = false,
  hideLabel = false,
  className = "",
  children,
}: FieldProps): React.JSX.Element {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`.trim()}>
      <span className={hideLabel ? "sr-only" : "text-[var(--ink-muted)]"}>
        {label}
        {required && !hideLabel && (
          <span aria-hidden="true" className="ml-0.5 text-[var(--danger)]">
            *
          </span>
        )}
      </span>
      {children}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </label>
  );
}
