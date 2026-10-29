import { satsToBtc } from "./Amount";
import { Input, type InputProps } from "./Input";

// === Types

export interface SatsInputProps extends Omit<InputProps, "type" | "value" | "onChange" | "trailing"> {
  value: string;
  onValueChange: (value: string) => void;
}

// === Component

export function SatsInput({ value, onValueChange, hint, ...rest }: SatsInputProps): React.JSX.Element {
  const sats: number = Number(value);
  const btcHint: string | null = value && Number.isFinite(sats) && sats > 0 ? `≈ ${satsToBtc(sats)} BTC` : null;
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(event) => onValueChange(event.target.value.replace(/[^\d]/g, ""))}
      hint={btcHint ?? hint}
      trailing={<span className="text-xs font-medium text-brand">sats</span>}
    />
  );
}
