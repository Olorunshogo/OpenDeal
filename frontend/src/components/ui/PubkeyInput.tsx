"use client";

import { pubkeyError } from "@/lib/pubkey";
import { PasteInput, type PasteInputProps } from "./PasteInput";

// === Types

export type PubkeyInputProps = Omit<PasteInputProps, "validate">;

// === Component

export function PubkeyInput({ placeholder = "02… or 64 hex characters", ...rest }: PubkeyInputProps): React.JSX.Element {
  return <PasteInput {...rest} placeholder={placeholder} validate={pubkeyError} />;
}
