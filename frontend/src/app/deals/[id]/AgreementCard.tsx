import { CircleCheck, CircleDashed, FileSignature } from "lucide-react";
import { Alert, Amount, Badge, Button, Card, CardHeader, DataList, HashValue, Skeleton } from "@/components/ui";
import type { AgreementVerification } from "@/lib/agreement-verification";
import { cn } from "@/lib/cn";

// === Types

export interface AgreementCardProps {
  verification: AgreementVerification | null;
  sellerSigned: boolean;
  buyerSigned: boolean;
  status: string;
  canSign: boolean;
  signing: boolean;
  alreadySigned: boolean;
  onSign: () => void;
}

// === Helpers

function SignatureState({ label, signed }: { label: string; signed: boolean }) {
  const Icon = signed ? CircleCheck : CircleDashed;
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
        signed ? "border-ok/40 bg-ok/10" : "border-line bg-glass",
      )}
    >
      <span className="inline-flex items-center gap-2 text-ink">
        <Icon aria-hidden="true" className={cn("size-4", signed ? "text-ok" : "text-ink-subtle")} />
        {label}
      </span>
      <span className={signed ? "text-ok" : "text-ink-subtle"}>{signed ? "signed" : "waiting"}</span>
    </li>
  );
}

// === Component

export function AgreementCard({
  verification,
  sellerSigned,
  buyerSigned,
  status,
  canSign,
  signing,
  alreadySigned,
  onSign,
}: AgreementCardProps): React.JSX.Element {
  const terms = verification?.valid ? verification.agreement : null;
  return (
    <Card>
      <CardHeader
        title="Agreement"
        description="Buyer and seller must both sign the same canonical bytes before funding."
        action={<FileSignature aria-hidden="true" className="size-5 text-violet-soft" />}
      />
      {terms ? (
        <DataList
          items={[
            { label: "Title", value: terms.title, wide: true },
            ...(terms.description
              ? [{ label: "Description", value: <span className="whitespace-pre-wrap">{terms.description}</span>, wide: true }]
              : []),
            { label: "Amount", value: <Amount sats={terms.amount_sats} size="sm" /> },
            { label: "Currency", value: terms.currency },
            { label: "Seller public key", value: <HashValue value={terms.seller_pubkey} /> },
            { label: "Buyer public key", value: <HashValue value={terms.buyer_pubkey} /> },
            { label: "Mediator public key", value: <HashValue value={terms.mediator_pubkey} /> },
            { label: "Seller payout address", value: <HashValue value={terms.seller_payout_address ?? ""} head={10} /> },
            { label: "Buyer refund address", value: <HashValue value={terms.buyer_refund_address ?? ""} head={10} /> },
            { label: "Delivery deadline", value: terms.delivery_deadline },
            { label: "Acceptance window", value: `${terms.acceptance_window_hours} hours` },
            { label: "Settlement model", value: <Badge tone="violet">{terms.settlement_model}</Badge> },
            { label: "Network", value: <Badge>{terms.network}</Badge> },
            { label: "Agreement version", value: terms.version },
            { label: "Created at", value: terms.created_at },
            {
              label: "Dispute eligibility",
              value: (
                <span className="text-ink-muted">
                  A party may open a dispute while funded, shipped, or accepted, before a settlement proposal is made.
                  This is protocol policy, not an agreement deadline.
                </span>
              ),
              wide: true,
            },
          ]}
        />
      ) : verification ? (
        <Alert tone="danger" title="Agreement verification failed">
          {verification.valid ? null : verification.error} Signing is disabled.
        </Alert>
      ) : (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <span className="text-xs text-ink-subtle">Verifying canonical agreement…</span>
        </div>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        <SignatureState label="Seller" signed={sellerSigned} />
        <SignatureState label="Buyer" signed={buyerSigned} />
      </ul>
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.12em] text-ink-subtle">Verified sha256</span>
        {verification?.valid ? (
          <HashValue value={verification.digest} head={16} tail={8} />
        ) : (
          <span className="text-xs text-ink-subtle">not verified</span>
        )}
      </div>
      {status === "draft" ? (
        <Button
          disabled={!canSign || alreadySigned}
          loading={signing}
          loadingLabel="Signing…"
          onClick={onSign}
          className="w-full sm:w-fit"
        >
          {alreadySigned ? "You already signed" : "Sign agreement"}
        </Button>
      ) : (
        <Alert tone="ok">Agreement complete ({status}).</Alert>
      )}
    </Card>
  );
}
