import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  error?: string;
  name?: string;
  className?: string;
}

// === Component

export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  error,
  name,
  className,
}: CheckboxProps): React.JSX.Element {
  return (
    <label
      className={cn(
        "group flex items-start gap-3 text-sm",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,box-shadow] duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-violet peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas",
          checked ? "border-brand bg-brand text-brand-ink" : "border-line-strong bg-glass group-hover:border-violet/60",
          error && !checked && "border-danger",
        )}
      >
        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ink">{label}</span>
        {description ? <span className="text-xs text-ink-muted">{description}</span> : null}
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </span>
    </label>
  );
}
