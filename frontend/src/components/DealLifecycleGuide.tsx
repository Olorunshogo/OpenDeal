import { DEAL_STEPS, nextDealStep, type LifecycleState } from "@/lib/lifecycle";
import type { ParticipantRole } from "@/lib/workflow";
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
  const next = nextDealStep(
    deal,
    role,
    sellerSigned,
    buyerSigned,
    validSignatures,
    disputeResolved
  );
  return (
    <section
      className="flex flex-col gap-2 rounded border border-[var(--accent)]/40 bg-[var(--bg-lift)] p-4"
      aria-label="Deal progress"
    >
      <p className="text-xs text-[var(--accent-soft)]">
        Step {next.index + 1} of {DEAL_STEPS.length} · {deal.status}
      </p>
      <h2 className="text-xl">Next: {next.title ?? DEAL_STEPS[next.index]}</h2>
      <p className="text-sm">
        Who acts: {next.actor}. Your agreement role: {role}.
      </p>
      <p className="text-sm text-[var(--ink-muted)]">{next.explanation}</p>
      <details>
        <summary className="cursor-pointer text-sm">
          View the complete workflow
        </summary>
        <ol className="list-decimal pl-6 text-sm">
          {DEAL_STEPS.map((step, i) => (
            <li
              key={step}
              aria-current={i === next.index ? "step" : undefined}
              className={
                i === next.index
                  ? "text-[var(--accent-soft)]"
                  : "text-[var(--ink-muted)]"
              }
            >
              {step}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
