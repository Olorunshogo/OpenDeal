"use client";

import { ClipboardPaste } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./IconButton";
import { Input, type InputProps } from "./Input";

// === Types

export interface PasteInputProps extends Omit<InputProps, "value" | "onChange" | "trailing" | "onBlur"> {
  value: string;
  onValueChange: (value: string) => void;
  validate?: (value: string) => string | null;
}

// === Component

export function PasteInput({ value, onValueChange, validate, error, ...rest }: PasteInputProps): React.JSX.Element {
  const [touched, setTouched] = useState<boolean>(false);
  const ownError: string | null = touched && value && validate ? validate(value) : null;

  async function onPaste(): Promise<void> {
    try {
      const text: string = (await navigator.clipboard.readText()).trim();
      if (text) {
        onValueChange(text);
        setTouched(true);
      }
    } catch {
      setTouched(true);
    }
  }

  return (
    <Input
      {...rest}
      mono
      spellCheck={false}
      autoComplete="off"
      value={value}
      onChange={(event) => onValueChange(event.target.value.trim())}
      onBlur={() => setTouched(true)}
      error={error ?? ownError ?? undefined}
      trailing={
        <IconButton label="Paste from clipboard" size="sm" icon={<ClipboardPaste className="size-4" />} onClick={onPaste} />
      }
    />
  );
}
