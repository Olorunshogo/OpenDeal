import { useId, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui";

export function ActionButton({
  label,
  onClick,
  disabled,
  reason,
  icon,
  variant = "secondary",
  loading = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the action is unavailable; shown as text under the button when it is disabled. */
  reason?: string | null;
  icon?: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  const reasonId: string = useId();
  const shownReason: string | null | undefined = disabled ? reason : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Button
        variant={variant}
        size="sm"
        fullWidth
        leading={icon}
        loading={loading}
        disabled={disabled}
        aria-describedby={shownReason ? reasonId : undefined}
        onClick={onClick}
      >
        {label}
      </Button>
      {shownReason ? (
        <span id={reasonId} className="text-[11px] leading-snug text-ink-subtle">
          {shownReason}
        </span>
      ) : null}
    </div>
  );
}
