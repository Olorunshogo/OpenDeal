import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  /** Keeps the label in the accessibility tree but hides it visually, for compact rows where a placeholder already states the field's purpose. */
  hideLabel?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

// === Component

export function Field({
  label,
  error,
  hint,
  required = false,
  hideLabel = false,
  htmlFor,
  className,
  children,
}: FieldProps): React.JSX.Element {
  const labelText: React.JSX.Element = (
    <span className={hideLabel ? "sr-only" : "flex items-center gap-1 text-sm font-medium text-ink"}>
      {label}
      {required && !hideLabel ? (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
    </span>
  );
  const footer: React.JSX.Element | null =
    error || hint ? (
      <span id={htmlFor ? `${htmlFor}-description` : undefined} className={cn("text-xs", error ? "text-danger" : "text-ink-subtle")}>
        {error ?? hint}
      </span>
    ) : null;

  if (htmlFor) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={htmlFor}>{labelText}</label>
        {children}
        {footer}
      </div>
    );
  }
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      {labelText}
      {children}
      {footer}
    </label>
  );
}
