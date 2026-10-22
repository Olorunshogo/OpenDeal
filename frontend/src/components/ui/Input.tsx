import type { InputHTMLAttributes } from "react";
import { Field } from "./Field";
import { fieldShellClass } from "./shell";

// === Types

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hideLabel?: boolean;
  /** Monospace, small text — for hex keys, pubkeys, addresses. */
  mono?: boolean;
  /** className for the wrapping label (e.g. a grid col-span), separate from the input's own className. */
  fieldClassName?: string;
}

// === Component

export function Input({
  label,
  error,
  hideLabel = false,
  required = false,
  mono = false,
  fieldClassName = "",
  className = "",
  disabled,
  ...rest
}: InputProps): React.JSX.Element {
  return (
    <Field label={label} error={error} required={required} hideLabel={hideLabel} className={fieldClassName}>
      <input
        className={fieldShellClass(
          { error: Boolean(error), disabled },
          `${mono ? "font-mono text-xs" : ""} ${className}`.trim(),
        )}
        required={required}
        disabled={disabled}
        {...rest}
      />
    </Field>
  );
}
