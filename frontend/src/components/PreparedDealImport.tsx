"use client";

import { useState } from "react";
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

const button =
  "rounded border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40";

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
  const [pasted, setPasted] = useState("");
  const [applied, setApplied] = useState(false);

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

  const review = preview
    ? preparedDealChecks(preview, { sessionPubkey, approvedMediators })
    : null;

  return (
    <details className="rounded border border-[var(--line)] p-3 text-sm">
      <summary className="cursor-pointer">
        Import prepared configuration (from opendeal-tui)
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-xs text-[var(--ink-muted)]">
          Load the JSON exported by <code>make tui</code>. It holds public keys,
          addresses and terms only. Nothing is created until you review the
          form and press Create deal; the API validates everything again.
        </p>
        <label className="flex flex-col gap-1">
          Configuration file
          <input
            type="file"
            accept="application/json,.json"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_PREPARED_DEAL_BYTES) {
                setPreview(null);
                setErrors(["Configuration file is too large."]);
                return;
              }
              void file.text().then(load, () => setErrors(["Could not read the file."]));
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          …or paste the JSON (TUI: Export → c copies it)
          <textarea
            className="min-h-20 rounded border border-[var(--line)] bg-[var(--bg-deep)] p-2 font-mono text-xs"
            value={pasted}
            disabled={disabled}
            onChange={(e) => setPasted(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`${button} w-fit`}
          disabled={disabled || !pasted.trim()}
          onClick={() => load(pasted)}
        >
          Preview pasted JSON
        </button>

        {errors.length ? (
          <div role="alert" className="text-[var(--danger)]">
            <p>Configuration rejected:</p>
            <ul className="list-disc pl-5">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {preview && review ? (
          <div className="flex flex-col gap-2 rounded border border-[var(--line)] p-3">
            <p className="font-semibold">Preview (not yet applied)</p>
            <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
              <dt>Title</dt>
              <dd>{preview.deal.title}</dd>
              {preview.deal.description ? (
                <>
                  <dt>Description</dt>
                  <dd className="break-words">{preview.deal.description}</dd>
                </>
              ) : null}
              <dt>Amount</dt>
              <dd>{preview.deal.amount_sats.toLocaleString()} sats</dd>
              <dt>Network</dt>
              <dd>{preview.network}</dd>
              <dt>Seller</dt>
              <dd className="break-all font-mono">{preview.participants.seller_pubkey}</dd>
              <dt>Buyer</dt>
              <dd className="break-all font-mono">{preview.participants.buyer_pubkey}</dd>
              <dt>Mediator</dt>
              <dd className="break-all font-mono">
                {preview.participants.mediator_pubkey}
                {preview.participants.mediator_display_name
                  ? ` (${preview.participants.mediator_display_name})`
                  : ""}
              </dd>
              <dt>Seller payout</dt>
              <dd className="break-all font-mono">{preview.deal.seller_payout_address}</dd>
              <dt>Buyer refund</dt>
              <dd className="break-all font-mono">{preview.deal.buyer_refund_address}</dd>
              <dt>Delivery deadline</dt>
              <dd>{preview.deal.delivery_deadline}</dd>
              <dt>Acceptance window</dt>
              <dd>{preview.deal.acceptance_window_hours} hours</dd>
              <dt>Escrow preview</dt>
              <dd className="break-all font-mono">{preview.escrow_preview.address}</dd>
            </dl>
            <ul className="flex flex-col gap-1 text-xs">
              {review.checks.map((check) => (
                <li
                  key={check.label}
                  className={check.ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}
                >
                  {check.ok ? "✔" : "⚠"} {check.label}: {check.detail}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={disabled || !review.canApply}
                onClick={() => {
                  onApply(preview);
                  setApplied(true);
                }}
              >
                Apply to form
              </button>
              <button
                type="button"
                className={button}
                onClick={() => {
                  setPreview(null);
                  setApplied(false);
                  setPasted("");
                }}
              >
                Discard
              </button>
            </div>
            {applied ? (
              <p role="status" className="text-[var(--ok)]">
                Applied. Review the form below, then press Create deal.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
