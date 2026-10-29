import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

export interface ButtonProps extends ComponentPropsWithRef<"button">, Omit<ButtonStyleOptions, "className"> {
  loading?: boolean;
  loadingLabel?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export interface ButtonLinkProps
  extends ComponentPropsWithRef<typeof Link>, Omit<ButtonStyleOptions, "className"> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

// === Classes

const BUTTON_BASE: string =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color,opacity] duration-200 disabled:pointer-events-none disabled:opacity-40";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-soft hover:shadow-glow-brand",
  secondary: "border border-line bg-glass text-ink backdrop-blur-sm hover:border-violet/60 hover:bg-violet/10",
  ghost: "text-ink-muted hover:bg-glass hover:text-ink",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
  link: "rounded-none text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-base",
};

export function buttonClass(options: ButtonStyleOptions = {}): string {
  const { variant = "primary", size = "md", fullWidth = false, className } = options;
  return cn(
    BUTTON_BASE,
    BUTTON_VARIANT[variant],
    variant === "link" ? "h-auto px-0" : BUTTON_SIZE[size],
    fullWidth && "w-full",
    className,
  );
}

// === Components

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel,
  leading,
  trailing,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : leading}
      {loading && loadingLabel ? loadingLabel : children}
      {loading ? null : trailing}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  fullWidth,
  leading,
  trailing,
  className,
  children,
  ...rest
}: ButtonLinkProps): React.JSX.Element {
  return (
    <Link className={buttonClass({ variant, size, fullWidth, className })} {...rest}>
      {leading}
      {children}
      {trailing}
    </Link>
  );
}
