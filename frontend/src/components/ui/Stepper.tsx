import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

// === Types

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  currentIndex: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

// === Component

export function Stepper({
  steps,
  currentIndex,
  orientation = "horizontal",
  className,
}: StepperProps): React.JSX.Element {
  const horizontal: boolean = orientation === "horizontal";
  return (
    <ol className={cn("grid grid-cols-1 gap-3", horizontal && "sm:auto-cols-fr sm:grid-flow-col", className)}>
      {steps.map((step, index) => {
        const done: boolean = index < currentIndex;
        const current: boolean = index === currentIndex;
        return (
          <li
            key={step.id}
            aria-current={current ? "step" : undefined}
            className={cn("flex items-start gap-3", horizontal && "sm:flex-col sm:gap-2")}
          >
            <span className={cn("flex items-center gap-2", horizontal && "w-full")}>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  done && "border-brand bg-brand text-brand-ink",
                  current && "border-violet bg-violet/15 text-violet-soft shadow-glow-violet",
                  !done && !current && "border-line text-ink-subtle",
                )}
              >
                {done ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              {horizontal && index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn("hidden h-px flex-1 sm:block", done ? "bg-brand" : "bg-line")}
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("text-sm font-medium", current || done ? "text-ink" : "text-ink-subtle")}>
                {step.label}
              </span>
              {step.description ? <span className="text-xs text-ink-muted">{step.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
