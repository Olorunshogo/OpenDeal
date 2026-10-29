"use client";

import { CircleCheck, FileJson, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, Amount, Button, DataList, HashValue, Textarea, UploadField, type DataListItem } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  MAX_PREPARED_DEAL_BYTES,
  parsePreparedDeal,
  preparedDealChecks,
  type PreparedDeal,
} from "@/lib/prepared-deal";

interface Props {
  network?: string;
  pilotMaxAmountSats: number | null;
  sessionPubkey?: string;
  approvedMediators?: { pubkey: string; display_name: string }[];
  disabled?: boolean;
  onApply: (deal: PreparedDeal) => void;
}

// Loads a configuration prepared with `make tui`, shows a preview, and only fills the form
// when the user applies it. Creating the deal still goes through the normal submit path.
export function PreparedDealImport({
  network,
  pilotMaxAmountSats,
  sessionPubkey,
  approvedMediators,
  disabled,
  onApply,
}: Props) {
  const [preview, setPreview] = useState<PreparedDeal | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pasted, setPasted] = useState<string>("");
  const [applied, setApplied] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);

  function load(text: string) {
    setApplied(false);
    setPreview(null);
    if (!network) {
      setErrors(["Waiting for the API network. Try again when the API is online."]);
      return;
    }
    const result = parsePreparedDeal(text, { network, pilotMaxAmountSats });
    if (result.ok) {
      setErrors([]);
      setPreview(result.value);
    } else {
      setErrors(result.errors);
    }
  }

  function onFileChange(next: File | null) {
    setFile(next);
    if (!next) return;
    if (next.size > MAX_PREPARED_DEAL_BYTES) {
      setPreview(null);
      setErrors(["Configuration file is too large."]);
      return;
    }
    void next.text().then(load, () => setErrors(["Could not read the file."]));
  }

  const review = preview ? preparedDealChecks(preview, { sessionPubkey, approvedMediators }) : null;

  const previewItems: DataListItem[] = preview
    ? [
        { label: "Title", value: preview.deal.title },
        { label: "Amount", value: <Amount sats={preview.deal.amount_sats} size="sm" /> },
        ...(preview.deal.description ? [{ label: "Description", value: preview.deal.description, wide: true }] : []),
        { label: "Network", value: preview.network },
        { label: "Seller", value: <HashValue value={preview.participants.seller_pubkey} /> },
        { label: "Buyer", value: <HashValue value={preview.participants.buyer_pubkey} /> },
        {
          label: "Mediator",
          value: (
            <span className="flex flex-col gap-0.5">
              <HashValue value={preview.participants.mediator_pubkey} />
              {preview.participants.mediator_display_name ? (
                <span className="text-xs text-ink-muted">{preview.participants.mediator_display_name}</span>
              ) : null}
            </span>
          ),
        },
        { label: "Seller payout", value: <HashValue value={preview.deal.seller_payout_address} head={10} /> },
        { label: "Buyer refund", value: <HashValue value={preview.deal.buyer_refund_address} head={10} /> },
        { label: "Delivery deadline", value: preview.deal.delivery_deadline },
        { label: "Acceptance window", value: `${preview.deal.acceptance_window_hours} hours` },
        { label: "Escrow preview", value: <HashValue value={preview.escrow_preview.address} head={10} />, wide: true },
      ]
    : [];

  return (
    <details className="group rounded-2xl border border-line bg-glass text-sm backdrop-blur-md">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-ink-muted hover:text-ink">
        <FileJson aria-hidden="true" className="size-4 text-violet-soft" />
        Import prepared configuration (from opendeal-tui)
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">
        <p className="text-xs text-ink-muted">
          Load the JSON exported by <code className="font-mono text-ink">make tui</code>. It holds public keys,
          addresses and terms only. Nothing is created until you review the form and press Create deal; the API
          validates everything again.
        </p>
        <UploadField
          label="Configuration file"
          accept="application/json,.json"
          file={file}
          onFileChange={onFileChange}
          disabled={disabled}
        />
        <Textarea
          label="…or paste the JSON (TUI: Export → c copies it)"
          mono
          value={pasted}
          disabled={disabled}
          onChange={(event) => setPasted(event.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          disabled={disabled || !pasted.trim()}
          onClick={() => load(pasted)}
        >
          Preview pasted JSON
        </Button>

        {errors.length ? (
          <Alert tone="danger" title="Configuration rejected">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {preview && review ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-violet/30 bg-violet-deep/10 p-4">
            <p className="font-display font-semibold text-ink">Preview (not yet applied)</p>
            <DataList items={previewItems} />
            <ul className="flex flex-col gap-1.5 text-xs">
              {review.checks.map((check) => {
                const Icon = check.ok ? CircleCheck : TriangleAlert;
                return (
                  <li key={check.label} className={cn("flex items-start gap-2", check.ok ? "text-ok" : "text-warn")}>
                    <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {check.label}: {check.detail}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={disabled || !review.canApply}
                onClick={() => {
                  onApply(preview);
                  setApplied(true);
                }}
              >
                Apply to form
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPreview(null);
                  setApplied(false);
                  setPasted("");
                  setFile(null);
                }}
              >
                Discard
              </Button>
            </div>
            {applied ? <Alert tone="ok">Applied. Review the form below, then press Create deal.</Alert> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
