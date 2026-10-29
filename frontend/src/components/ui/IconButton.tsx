import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./Button";

// === Types

export interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

// === Component

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(buttonClass({ variant, size }), "aspect-square px-0", className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
