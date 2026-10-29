import { Wallet } from "lucide-react";
import { Alert, Amount, Badge, Card, CardHeader, CopyButton, DataList, HashValue } from "@/components/ui";
import type { FundingInstructions } from "@/lib/api";

// === Types

export interface FundingCardProps {
  escrowAddress: string;
  funding: FundingInstructions | undefined;
  fundingError: string | null;
}

// === Component

export function FundingCard({ escrowAddress, funding, fundingError }: FundingCardProps): React.JSX.Element {
  const address: string = funding?.address ?? escrowAddress;
  return (
    <Card tone="brand">
      <CardHeader
        title="Funding instructions"
        description="Send exactly the expected amount to the 2-of-3 escrow address, then use Verify funding."
        action={<Wallet aria-hidden="true" className="size-5 text-brand" />}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-2xl border border-line bg-canvas/60 px-4 py-3 font-mono text-xs text-ink">
          {address}
        </code>
        <CopyButton value={address} label="Copy address" size="md" />
      </div>
      {funding ? (
        <DataList
          columns={3}
          items={[
            { label: "Expected amount", value: <Amount sats={funding.expected_amount_sats} size="sm" /> },
            { label: "Confirmations needed", value: funding.required_confirmations },
            { label: "Network", value: <Badge tone="violet">{funding.network}</Badge> },
          ]}
        />
      ) : null}
      {fundingError ? <Alert tone="danger">{fundingError}</Alert> : null}
      {funding ? (
        <details className="group rounded-2xl border border-line">
          <summary className="cursor-pointer px-4 py-2.5 text-xs text-ink-muted hover:text-ink">Technical details</summary>
          <div className="flex flex-col gap-2 border-t border-line p-4">
            <span className="text-xs text-ink-subtle">scriptPubKey</span>
            <HashValue value={funding.script_pubkey_hex} full />
            <span className="text-xs text-ink-subtle">witness script</span>
            <HashValue value={funding.witness_script_hex} full />
          </div>
        </details>
      ) : null}
    </Card>
  );
}
