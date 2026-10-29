"use client";

import { bitcoinAddressError } from "@/lib/bitcoin-address";
import { PasteInput, type PasteInputProps } from "./PasteInput";

// === Types

export interface AddressInputProps extends Omit<PasteInputProps, "validate"> {
  network: string;
}

// === Component

export function AddressInput({ network, placeholder, ...rest }: AddressInputProps): React.JSX.Element {
  return (
    <PasteInput
      {...rest}
      placeholder={placeholder ?? (network === "regtest" ? "bcrt1…" : network === "bitcoin" ? "bc1…" : "tb1…")}
      validate={network ? (value) => bitcoinAddressError(value, network) : undefined}
    />
  );
}
