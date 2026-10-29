"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Field } from "./Field";
import { INPUT_CONTROL_CLASS, inputShellClass } from "./shell";

// === Types

export interface InputProps extends ComponentPropsWithRef<"input"> {
  label: string;
  error?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  /** Monospace, small text for hex keys, pubkeys, and addresses. */
  mono?: boolean;
  /** className for the wrapping label (e.g. a grid col-span), separate from the input's own className. */
  fieldClassName?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}

// === Component

export function Input({
  label,
  error,
  hint,
  hideLabel = false,
  required = false,
  mono = false,
  fieldClassName,
  className,
  disabled,
  readOnly,
  leading,
  trailing,
  id,
  ...rest
}: InputProps): React.JSX.Element {
  const generatedId: string = useId();
  const inputId: string = id ?? generatedId;
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      hideLabel={hideLabel}
      htmlFor={inputId}
      className={fieldClassName}
    >
      <span className={inputShellClass({ error, disabled, readOnly })}>
        {leading}
        <input
          id={inputId}
          aria-describedby={error || hint ? `${inputId}-description` : undefined}
          className={cn(INPUT_CONTROL_CLASS, mono && "font-mono text-xs", className)}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        {trailing}
      </span>
    </Field>
  );
}
