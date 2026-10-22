import type { TextareaHTMLAttributes } from "react";
import { Field } from "./Field";
import { fieldShellClass } from "./shell";

// === Types

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hideLabel?: boolean;
  fieldClassName?: string;
}

// === Component

export function Textarea({
  label,
  error,
  hideLabel = false,
  required = false,
  fieldClassName = "",
  className = "",
  disabled,
  ...rest
}: TextareaProps): React.JSX.Element {
  return (
    <Field label={label} error={error} required={required} hideLabel={hideLabel} className={fieldClassName}>
      <textarea
        className={fieldShellClass(
          { error: Boolean(error), disabled },
          `min-h-28 ${className}`.trim(),
        )}
        required={required}
        disabled={disabled}
        {...rest}
      />
    </Field>
  );
}
