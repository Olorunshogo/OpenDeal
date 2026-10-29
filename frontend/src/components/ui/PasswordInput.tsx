"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";
import { Input, type InputProps } from "./Input";

// === Types

export interface PasswordInputProps extends Omit<InputProps, "type" | "trailing"> {
  showStrength?: boolean;
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

// === Helpers

export function passwordStrength(value: string): PasswordStrength {
  let score: number = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 20) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4) as PasswordStrength;
}

const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  0: "Too short",
  1: "Weak",
  2: "Fair",
  3: "Strong",
  4: "Very strong",
};

const STRENGTH_TONE: Record<PasswordStrength, string> = {
  0: "bg-danger",
  1: "bg-danger",
  2: "bg-warn",
  3: "bg-ok",
  4: "bg-ok",
};

// === Component

export function PasswordInput({ showStrength = false, hint, value, ...rest }: PasswordInputProps): React.JSX.Element {
  const [visible, setVisible] = useState<boolean>(false);
  const text: string = typeof value === "string" ? value : "";
  const strength: PasswordStrength = passwordStrength(text);

  const strengthHint: React.JSX.Element | null =
    showStrength && text ? (
      <span className="flex flex-col gap-1">
        <span className="grid grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className={cn("h-1 rounded-full", step <= Math.max(strength, 1) ? STRENGTH_TONE[strength] : "bg-line")}
            />
          ))}
        </span>
        <span>Strength: {STRENGTH_LABEL[strength]}</span>
      </span>
    ) : null;

  return (
    <Input
      {...rest}
      value={value}
      type={visible ? "text" : "password"}
      autoComplete={rest.autoComplete ?? "new-password"}
      hint={strengthHint ?? hint}
      trailing={
        <IconButton
          label={visible ? "Hide passphrase" : "Show passphrase"}
          size="sm"
          icon={visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          onClick={() => setVisible((current) => !current)}
        />
      }
    />
  );
}
