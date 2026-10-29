import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// === Types

export type AlertTone = "info" | "ok" | "warn" | "danger";

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

// === Classes

const ALERT_TONE: Record<AlertTone, string> = {
  info: "border-violet/40 bg-violet/10",
  ok: "border-ok/40 bg-ok/10",
  warn: "border-warn/40 bg-warn/10",
  danger: "border-danger/50 bg-danger/10",
};

const ALERT_ICON_TONE: Record<AlertTone, string> = {
  info: "text-violet-soft",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

const ALERT_ICON: Record<AlertTone, typeof Info> = {
  info: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  danger: CircleAlert,
};

// === Component

export function Alert({ tone = "info", title, action, className, children }: AlertProps): React.JSX.Element {
  const Icon = ALERT_ICON[tone];
  return (
    <div
      role={tone === "danger" || tone === "warn" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-2xl border px-4 py-3 text-sm text-ink", ALERT_TONE[tone], className)}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", ALERT_ICON_TONE[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-ink-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}
