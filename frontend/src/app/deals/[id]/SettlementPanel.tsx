"use client";

import { Ban, PenLine, Radio, Send } from "lucide-react";
import {
  AddressInput,
  Alert,
  Amount,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataList,
  HashValue,
  Input,
  SatsInput,
  SegmentedControl,
  Textarea,
  type SegmentOption,
} from "@/components/ui";
import type { Deal, SettlementProgress, SettlementPurpose } from "@/lib/api";
import { purposeLabel, type PsbtReviewSummary, type SettlementPsbtPolicy } from "@/lib/psbt";

// === Types

export interface SettlementPanelProps {
  deal: Deal;
  settlement: SettlementProgress | null;
  canPropose: boolean;
  isParty: boolean;
  purpose: SettlementPurpose;
  setPurpose: (p: SettlementPurpose) => void;
  destination: string;
  setDestination: (v: string) => void;
  feeSats: string;
  setFeeSats: (v: string) => void;
  proposedPurpose: string | null;
  psbtReview: { summary: PsbtReviewSummary | null; error: string | null } | null;
  settlementPolicy: SettlementPsbtPolicy | null;
  authorizedDestination: string | null;
  reviewed: boolean;
  setReviewed: (v: boolean) => void;
  declined: boolean;
  setDeclined: (v: boolean) => void;
  pastedPsbt: string;
  setPastedPsbt: (v: string) => void;
  confirmBlockHash: string;
  setConfirmBlockHash: (v: string) => void;
  busy: boolean;
  hasLocalSecret: boolean;
  onPropose: () => void;
  onSignLocal: () => void;
  onAttachPaste: () => void;
  onFinalize: () => void;
  onConfirm: () => void;
}

// === Data

const PURPOSE_OPTIONS: SegmentOption<SettlementPurpose>[] = [
  { value: "payout_seller", label: "Payout seller" },
  { value: "refund_buyer", label: "Refund buyer" },
];

// === Component

export function SettlementPanel({
  deal,
  settlement,
  canPropose,
  isParty,
  purpose,
  setPurpose,
  destination,
  setDestination,
  feeSats,
  setFeeSats,
  proposedPurpose,
  psbtReview,
  settlementPolicy,
  authorizedDestination,
  reviewed,
  setReviewed,
  declined,
  setDeclined,
  pastedPsbt,
  setPastedPsbt,
  confirmBlockHash,
  setConfirmBlockHash,
  busy,
  hasLocalSecret,
  onPropose,
  onSignLocal,
  onAttachPaste,
  onFinalize,
  onConfirm,
}: SettlementPanelProps): React.JSX.Element {
  const hasPsbt: boolean = Boolean(deal.current_psbt);
  const summary: PsbtReviewSummary | null | undefined = psbtReview?.summary;
  const canAct: boolean = isParty && hasPsbt && !deal.settlement_txid && !declined;
  const requiredSignatures: number = settlement?.required_signatures ?? 2;
  const validSignatures: number = settlement?.valid_signatures ?? summary?.partial_sigs_total ?? 0;
  const phase: string = settlement?.phase ?? deal.settlement_phase;
  const canCheckConfirmation: boolean = isParty && Boolean(deal.settlement_txid) && phase !== "confirmed";
  const signatureProgress: number = Math.min(100, Math.round((validSignatures / Math.max(requiredSignatures, 1)) * 100));

  return (
    <Card>
      <CardHeader
        title="Settlement PSBT"
        description="Review outputs and fee before you sign. Keys never leave your browser; the API only combines PSBT updates."
        action={<Badge tone="violet">{phase}</Badge>}
      />

      {canPropose && !hasPsbt ? (
        <div className="flex flex-col gap-4">
          <SegmentedControl label="Purpose" options={PURPOSE_OPTIONS} value={purpose} onChange={setPurpose} fullWidth />
          <AddressInput
            label="Destination address"
            network={deal.network}
            value={destination}
            onValueChange={setDestination}
            hint="Must exactly match the address in the verified signed agreement."
          />
          <SatsInput label="Fee" value={feeSats} onValueChange={setFeeSats} hint="Minimum 200 sats." />
          <Button loading={busy} loadingLabel="Proposing…" onClick={onPropose} className="w-full sm:w-fit">
            Propose settlement
          </Button>
        </div>
      ) : null}

      {!hasPsbt && !canPropose ? (
        <p className="text-sm text-ink-muted">
          {deal.settlement_txid ? "Settlement already broadcast." : "Fund the deal before proposing a settlement PSBT."}
        </p>
      ) : null}

      {hasPsbt && summary ? (
        <div className="flex flex-col gap-4 text-sm">
          <Alert tone="warn" title={`Purpose: ${purposeLabel(proposedPurpose)}`}>
            This {proposedPurpose === "refund_buyer" ? "refunds the buyer" : "pays the seller"}. The destination is
            checked against the signed agreement. Independently confirm the address with the recipient before signing.
          </Alert>
          <DataList
            items={[
              {
                label: "Signed destination",
                value: authorizedDestination ? <HashValue value={authorizedDestination} full /> : "unavailable",
                wide: true,
              },
              { label: "Unsigned txid", value: <HashValue value={summary.unsigned_txid} />, wide: true },
              { label: "Fee", value: <Amount sats={summary.fee_sats} size="sm" showBtc={false} /> },
              {
                label: "Confirmations",
                value: `${settlement?.confirmations ?? deal.settlement_confirmations} confirmation(s)`,
              },
            ]}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.12em] text-ink-subtle">Inputs</span>
            <ul className="flex flex-col gap-2">
              {summary.inputs.map((input) => (
                <li
                  key={`${input.txid}:${input.vout}`}
                  className="flex flex-col gap-1 rounded-2xl border border-line bg-glass px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <HashValue value={`${input.txid}:${input.vout}`} head={10} tail={8} />
                  <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    {input.amount_sats != null ? <Amount sats={input.amount_sats} size="sm" showBtc={false} /> : null}
                    {input.partial_sigs > 0 ? <Badge tone="ok">{input.partial_sigs} sig(s)</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.12em] text-ink-subtle">Outputs</span>
            <ul className="flex flex-col gap-2">
              {summary.outputs.map((output, idx) => (
                <li
                  key={`${output.script_hex}:${idx}`}
                  className="flex flex-col gap-1 rounded-2xl border border-line bg-glass px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  {output.address ? (
                    <HashValue value={output.address} head={12} tail={8} />
                  ) : (
                    <span className="font-mono text-xs text-ink">script:{output.script_hex.slice(0, 20)}…</span>
                  )}
                  <Amount sats={output.amount_sats} size="sm" showBtc={false} />
                </li>
              ))}
            </ul>
          </div>
          {deal.funding_amount_sats != null && summary.outputs[0] ? (
            <p className="text-xs text-ink-subtle">
              Check: funding {deal.funding_amount_sats.toLocaleString()} − fee {summary.fee_sats.toLocaleString()} ={" "}
              {(deal.funding_amount_sats - summary.fee_sats).toLocaleString()} (output{" "}
              {summary.outputs[0].amount_sats.toLocaleString()})
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-xs text-ink-muted">
              <span>Signatures</span>
              <span className="text-ink">
                {validSignatures} / {requiredSignatures} needed
              </span>
            </span>
            <div
              className="h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Signatures collected"
              aria-valuemin={0}
              aria-valuemax={requiredSignatures}
              aria-valuenow={validSignatures}
            >
              <span
                className="block h-full rounded-full bg-linear-to-r from-violet to-brand transition-[width] duration-500"
                style={{ width: `${signatureProgress}%` }}
              />
            </div>
          </div>

          {declined ? (
            <Alert
              tone="danger"
              title="You declined to sign this PSBT"
              action={
                <Button variant="link" size="sm" onClick={() => setDeclined(false)}>
                  Reconsider
                </Button>
              }
            >
              Do not attach a signature until a new proposal matches what you expect.
            </Alert>
          ) : (
            <>
              <Checkbox
                label="I reviewed the purpose, destination, output amount, and fee."
                description="I understand signing moves escrow with 2-of-3."
                checked={reviewed}
                onChange={setReviewed}
              />
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button
                  leading={<PenLine className="size-4" />}
                  loading={busy}
                  loadingLabel="Signing…"
                  disabled={!canAct || !reviewed || !hasLocalSecret || !settlementPolicy}
                  onClick={onSignLocal}
                >
                  Sign with local secret
                </Button>
                <Button
                  variant="danger"
                  leading={<Ban className="size-4" />}
                  disabled={!canAct || busy}
                  onClick={() => setDeclined(true)}
                >
                  Decline to sign
                </Button>
                <Button
                  variant="secondary"
                  leading={<Radio className="size-4" />}
                  disabled={!isParty || busy || Boolean(deal.settlement_txid) || validSignatures < requiredSignatures}
                  title={
                    validSignatures < requiredSignatures
                      ? `Needs ${requiredSignatures} of 3 signatures before it can be finalized`
                      : undefined
                  }
                  onClick={onFinalize}
                >
                  Finalize / broadcast
                </Button>
              </div>
              {!deal.settlement_txid && validSignatures < requiredSignatures ? (
                <p className="text-xs text-ink-subtle">
                  Finalize unlocks at {requiredSignatures} of 3 signatures ({validSignatures} so far).
                  {!hasLocalSecret ? " Unlock your signing key above to add yours." : ""}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line p-4">
                <Textarea
                  label="Or paste a wallet-signed PSBT"
                  mono
                  value={pastedPsbt}
                  onChange={(event) => setPastedPsbt(event.target.value)}
                  placeholder="cHNidP…"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  leading={<Send className="size-3.5" />}
                  disabled={!canAct || !reviewed || busy || !pastedPsbt.trim() || !settlementPolicy}
                  onClick={onAttachPaste}
                  className="w-full sm:w-fit"
                >
                  Attach pasted PSBT
                </Button>
              </div>
            </>
          )}
          <details className="rounded-2xl border border-line">
            <summary className="cursor-pointer px-4 py-2.5 text-xs text-ink-muted hover:text-ink">Raw PSBT</summary>
            <pre className="max-h-40 overflow-auto border-t border-line p-4 font-mono text-[10px] break-all whitespace-pre-wrap text-ink-muted">
              {deal.current_psbt}
            </pre>
          </details>
        </div>
      ) : null}

      {hasPsbt && psbtReview?.error ? (
        <Alert tone="danger" title="PSBT decode failed">
          {psbtReview.error}
        </Alert>
      ) : null}

      {deal.settlement_txid ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
          <DataList
            items={[
              { label: "Settlement txid", value: <HashValue value={deal.settlement_txid} />, wide: true },
              { label: "Status", value: <Badge tone={phase === "confirmed" ? "ok" : "brand"}>{phase}</Badge> },
              {
                label: "Confirmations",
                value: `${settlement?.confirmations ?? deal.settlement_confirmations} confirmation(s)`,
              },
            ]}
          />
          {canCheckConfirmation ? (
            <>
              <Input
                label="Block hash (only needed without Core txindex)"
                mono
                value={confirmBlockHash}
                onChange={(event) => setConfirmBlockHash(event.target.value)}
                placeholder="optional"
              />
              <Button variant="secondary" loading={busy} loadingLabel="Checking…" onClick={onConfirm} className="w-full sm:w-fit">
                Check confirmation
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
