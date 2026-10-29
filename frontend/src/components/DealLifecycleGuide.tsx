import { Card, Stepper, StatusBadge, type StepperStep } from "@/components/ui";
import { DEAL_STEPS, nextDealStep, type LifecycleState } from "@/lib/lifecycle";
import type { ParticipantRole } from "@/lib/workflow";

const WORKFLOW_STEPS: StepperStep[] = DEAL_STEPS.map((step) => ({ id: step, label: step }));

export function DealLifecycleGuide({
  deal,
  role,
  sellerSigned,
  buyerSigned,
  validSignatures = 0,
  disputeResolved = false,
}: {
  deal: LifecycleState;
  role: ParticipantRole;
  sellerSigned: boolean;
  buyerSigned: boolean;
  validSignatures?: number;
  disputeResolved?: boolean;
}) {
  const next = nextDealStep(deal, role, sellerSigned, buyerSigned, validSignatures, disputeResolved);
  const progress: number = Math.round(((next.index + 1) / DEAL_STEPS.length) * 100);
  return (
    <Card tone="brand" aria-label="Deal progress" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-brand-soft">
          Step {next.index + 1} of {DEAL_STEPS.length}
        </p>
        <StatusBadge status={deal.status} />
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={DEAL_STEPS.length}
        aria-valuenow={next.index + 1}
        aria-label="Deal progress"
      >
        <span className="block h-full rounded-full bg-linear-to-r from-brand to-brand-soft" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-xl font-semibold text-ink">Next: {next.title ?? DEAL_STEPS[next.index]}</h2>
        <p className="text-sm text-ink">
          Who acts: <span className="text-brand-soft">{next.actor}</span>. Your agreement role:{" "}
          <span className="text-violet-soft">{role}</span>.
        </p>
        <p className="text-sm text-ink-muted">{next.explanation}</p>
      </div>
      <details className="group">
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">View the complete workflow</summary>
        <div className="border-t border-line pt-4">
          <Stepper steps={WORKFLOW_STEPS} currentIndex={next.index} orientation="vertical" />
        </div>
      </details>
    </Card>
  );
}
