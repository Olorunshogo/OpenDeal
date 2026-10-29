"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Field } from "./Field";
import { INPUT_CONTROL_CLASS, inputShellClass } from "./shell";

// === Types

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  label: string;
  error?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  mono?: boolean;
  fieldClassName?: string;
}

// === Component

export function Textarea({
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
  id,
  ...rest
}: TextareaProps): React.JSX.Element {
  const generatedId: string = useId();
  const textareaId: string = id ?? generatedId;
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      hideLabel={hideLabel}
      htmlFor={textareaId}
      className={fieldClassName}
    >
      <span className={inputShellClass({ error, disabled, readOnly, shape: "box" })}>
        <textarea
          id={textareaId}
          aria-describedby={error || hint ? `${textareaId}-description` : undefined}
          className={cn(INPUT_CONTROL_CLASS, "min-h-28 resize-y", mono && "font-mono text-xs", className)}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      </span>
    </Field>
  );
}
