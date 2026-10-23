"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  attachPsbtSignature,
  confirmSettlement,
  finalizeSettlement,
  getAgreement,
  getDeal,
  getEvents,
  getReceipt,
  getReputation,
  getSettlement,
  listEvidence,
  openDispute,
  prepareFunding,
  proposeSettlement,
  signAgreement,
  submitEvidence,
  transitionDeal,
  verifyFunding,
  type Deal,
  type DealEvent,
  type DealStatus,
  type SettlementProgress,
  type SettlementPurpose,
} from "@/lib/api";
import { normPubkey, signCanonicalBytes } from "@/lib/crypto";
import { purposeLabel, signPsbtWithSecret, summarizePsbt } from "@/lib/psbt";
import { loadSession, type Session } from "@/lib/session";

export function DealDetailClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [receiptJson, setReceiptJson] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [purpose, setPurpose] = useState<SettlementPurpose>("payout_seller");
  const [destination, setDestination] = useState("");
  const [feeSats, setFeeSats] = useState("500");
  const [pastedPsbt, setPastedPsbt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [confirmBlockHash, setConfirmBlockHash] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("note");
  const [evidenceContent, setEvidenceContent] = useState("");
  const [evidenceBusy, setEvidenceBusy] = useState(false);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  useEffect(() => {
    const fromMediator = searchParams.get("purpose");
    if (fromMediator === "payout_seller" || fromMediator === "refund_buyer") {
      setPurpose(fromMediator);
    }
  }, [searchParams]);

  const dealQuery = useQuery({
    queryKey: ["deal", id],
    queryFn: () => getDeal(id),
    enabled: Boolean(id),
  });
  const agreementQuery = useQuery({
    queryKey: ["agreement", id],
    queryFn: () => getAgreement(id),
    enabled: Boolean(id),
  });
  const eventsQuery = useQuery({
    queryKey: ["events", id],
    queryFn: () => getEvents(id),
    enabled: Boolean(id),
  });
  const evidenceQuery = useQuery({
    queryKey: ["evidence", id],
    queryFn: () => listEvidence(id),
    enabled: Boolean(id),
  });
  const sellerReputationQuery = useQuery({
    queryKey: ["reputation", dealQuery.data?.seller_pubkey],
    queryFn: () => getReputation(dealQuery.data!.seller_pubkey),
    enabled: Boolean(dealQuery.data?.seller_pubkey),
  });
  const buyerReputationQuery = useQuery({
    queryKey: ["reputation", dealQuery.data?.buyer_pubkey],
    queryFn: () => getReputation(dealQuery.data!.buyer_pubkey),
    enabled: Boolean(dealQuery.data?.buyer_pubkey),
  });
  const settlementQuery = useQuery({
    queryKey: ["settlement", id, session?.token],
    queryFn: () => getSettlement(session!.token, id),
    enabled: Boolean(session?.token) && Boolean(dealQuery.data?.current_psbt),
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === "broadcasting" || phase === "broadcast" || phase === "broadcast_unknown"
        ? 5000
        : false;
    },
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["deal", id] });
    await queryClient.invalidateQueries({ queryKey: ["agreement", id] });
    await queryClient.invalidateQueries({ queryKey: ["events", id] });
    await queryClient.invalidateQueries({ queryKey: ["settlement", id] });
  }

  async function onConfirmSettlement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    setSettlementBusy(true);
    try {
      await confirmSettlement(session.token, id, confirmBlockHash.trim() || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "confirm failed");
    } finally {
      setSettlementBusy(false);
    }
  }

  async function onSubmitEvidence() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    if (!evidenceContent.trim()) {
      setError("Evidence text is required.");
      return;
    }
    setEvidenceBusy(true);
    try {
      await submitEvidence(session.token, id, {
        kind: evidenceKind.trim() || "note",
        content: evidenceContent.trim(),
      });
      setEvidenceContent("");
      await queryClient.invalidateQueries({ queryKey: ["evidence", id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "evidence submit failed");
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function withSession(action: (token: string) => Promise<unknown>) {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    try {
      await action(session.token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    }
  }

  async function onSignAgreement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    if (!session.signingSecret) {
      setError(
        "No local signing secret. Use “Create regtest identity” or add a signing secret under Advanced.",
      );
      return;
    }
    const agreement = agreementQuery.data;
    if (!agreement) {
      setError("Agreement not loaded yet.");
      return;
    }
    setSigning(true);
    try {
      const signature = signCanonicalBytes(session.signingSecret, agreement.canonical_hex);
      if (normPubkey(signature.pubkey) !== normPubkey(session.pubkey)) {
        setError("Signing secret does not match session pubkey.");
        return;
      }
      await signAgreement(session.token, id, signature);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign failed");
    } finally {
      setSigning(false);
    }
  }

  const deal = dealQuery.data;
  const agreement = agreementQuery.data;
  const signed = new Set((agreement?.signed_pubkeys ?? []).map(normPubkey));
  const sellerSigned = agreement
    ? signed.has(normPubkey(agreement.agreement.seller_pubkey))
    : false;
  const buyerSigned = agreement
    ? signed.has(normPubkey(agreement.agreement.buyer_pubkey))
    : false;
  const isParty =
    session &&
    agreement &&
    [agreement.agreement.seller_pubkey, agreement.agreement.buyer_pubkey, agreement.agreement.mediator_pubkey]
      .map(normPubkey)
      .includes(normPubkey(session.pubkey));
  const alreadySigned = session ? signed.has(normPubkey(session.pubkey)) : false;
  const canSign =
    deal?.status === "draft" && Boolean(isParty) && !alreadySigned && Boolean(session?.signingSecret);
  const agreedOrLater = deal && deal.status !== "draft";
  const canFund =
    deal?.status === "agreed" || deal?.status === "awaiting_payment";
  const canPropose =
    Boolean(isParty) &&
    Boolean(deal?.funding_txid) &&
    !deal?.settlement_txid &&
    !["draft", "settled", "cancelled", "refunded"].includes(String(deal?.status));

  const proposedPurpose = useMemo(
    () => latestSettlementPurpose(eventsQuery.data),
    [eventsQuery.data],
  );

  const psbtReview = useMemo(() => {
    if (!deal?.current_psbt) {
      return null;
    }
    try {
      return { summary: summarizePsbt(deal.current_psbt, deal.network), error: null as string | null };
    } catch (err) {
      return {
        summary: null,
        error: err instanceof Error ? err.message : "failed to decode PSBT",
      };
    }
  }, [deal?.current_psbt, deal?.network]);

  useEffect(() => {
    setReviewed(false);
    setDeclined(false);
    setPastedPsbt("");
  }, [deal?.current_psbt]);

  async function onProposeSettlement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    const fee = Number(feeSats);
    if (!destination.trim()) {
      setError("Destination address is required.");
      return;
    }
    if (!Number.isFinite(fee) || fee < 200) {
      setError("Fee must be at least 200 sats (policy floor).");
      return;
    }
    setSettlementBusy(true);
    try {
      await proposeSettlement(session.token, id, {
        destination_address: destination.trim(),
        fee_sats: fee,
        purpose,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "propose failed");
    } finally {
      setSettlementBusy(false);
    }
  }

  async function onAttachSignedPsbt(signedPsbt: string) {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    if (!reviewed) {
      setError("Confirm you reviewed outputs and fee before attaching a signature.");
      return;
    }
    setSettlementBusy(true);
    try {
      await attachPsbtSignature(session.token, id, signedPsbt.trim());
      setPastedPsbt("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "attach failed");
    } finally {
      setSettlementBusy(false);
    }
  }

  async function onSignWithLocalSecret() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    if (!session.signingSecret) {
      setError("No local signing secret for PSBT signing.");
      return;
    }
    if (!deal?.current_psbt) {
      setError("No settlement PSBT to sign.");
      return;
    }
    if (!reviewed) {
      setError("Confirm you reviewed outputs and fee before signing.");
      return;
    }
    setSettlementBusy(true);
    try {
      const signed = signPsbtWithSecret(deal.current_psbt, session.signingSecret);
      await attachPsbtSignature(session.token, id, signed);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "local PSBT sign failed");
    } finally {
      setSettlementBusy(false);
    }
  }

  async function onFinalizeSettlement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (footer).");
      return;
    }
    setSettlementBusy(true);
    try {
      await finalizeSettlement(session.token, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "finalize failed");
    } finally {
      setSettlementBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="animate-rise">
          <NetworkBanner network={deal?.network} />
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deal</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
            {deal?.title ?? "Loading…"}
          </h1>
          {deal ? (
            <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
              <p>
                Status: <span className="text-[var(--ok)]">{deal.status}</span>
              </p>
              <p>
                Settlement:{" "}
                <span className="text-[var(--accent-soft)]">{deal.settlement_model}</span>
              </p>
              <p>
                Network:{" "}
                <span className="network-badge text-[var(--accent-soft)]">{deal.network}</span>
              </p>
              <p>
                Amount: {deal.amount_sats.toLocaleString()} sats ({deal.currency})
              </p>
              <p className="text-xs">
                Seller history:{" "}
                {sellerReputationQuery.data
                  ? `${sellerReputationQuery.data.settled} settled · ${sellerReputationQuery.data.disputed} disputed`
                  : "…"}
                {" · "}Buyer history:{" "}
                {buyerReputationQuery.data
                  ? `${buyerReputationQuery.data.settled} settled · ${buyerReputationQuery.data.disputed} disputed`
                  : "…"}
              </p>
              {deal.escrow_address ? (
                <p className="break-all font-mono text-xs text-[var(--ink)]">
                  Escrow: {deal.escrow_address}
                </p>
              ) : null}
              {deal.funding_txid ? (
                <p className="break-all font-mono text-xs">Funding tx: {deal.funding_txid}</p>
              ) : null}
              {deal.settlement_txid ? (
                <p className="break-all font-mono text-xs">Settlement tx: {deal.settlement_txid}</p>
              ) : null}
              <p className="break-all font-mono text-[10px] opacity-70">id: {deal.id}</p>
              <p>
                <Link href={`/deals/${deal.id}/checkout`} className="underline">
                  Checkout view
                </Link>
              </p>
            </div>
          ) : null}

          {agreement ? (
            <div className="mt-6 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
              <h2 className="font-[family-name:var(--font-display)] text-xl">Agreement</h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Buyer and seller must both sign the same canonical bytes before funding.
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>
                  Seller:{" "}
                  <span className={sellerSigned ? "text-[var(--ok)]" : "text-[var(--ink-muted)]"}>
                    {sellerSigned ? "signed" : "waiting"}
                  </span>
                </li>
                <li>
                  Buyer:{" "}
                  <span className={buyerSigned ? "text-[var(--ok)]" : "text-[var(--ink-muted)]"}>
                    {buyerSigned ? "signed" : "waiting"}
                  </span>
                </li>
              </ul>
              <p className="mt-2 break-all font-mono text-[10px] text-[var(--ink-muted)]">
                canonical sha256 id · {deal?.id}
              </p>
              {deal?.status === "draft" ? (
                <button
                  type="button"
                  disabled={!canSign || signing}
                  onClick={onSignAgreement}
                  className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
                >
                  {signing
                    ? "Signing…"
                    : alreadySigned
                      ? "You already signed"
                      : "Sign agreement"}
                </button>
              ) : (
                <p className="mt-3 text-sm text-[var(--ok)]">Agreement complete ({deal?.status}).</p>
              )}
            </div>
          ) : null}

          {deal ? (
            <SettlementPanel
              deal={deal}
              settlement={settlementQuery.data ?? null}
              canPropose={canPropose}
              isParty={Boolean(isParty)}
              purpose={purpose}
              setPurpose={setPurpose}
              destination={destination}
              setDestination={setDestination}
              feeSats={feeSats}
              setFeeSats={setFeeSats}
              proposedPurpose={proposedPurpose}
              psbtReview={psbtReview}
              reviewed={reviewed}
              setReviewed={setReviewed}
              declined={declined}
              setDeclined={setDeclined}
              pastedPsbt={pastedPsbt}
              setPastedPsbt={setPastedPsbt}
              confirmBlockHash={confirmBlockHash}
              setConfirmBlockHash={setConfirmBlockHash}
              busy={settlementBusy}
              hasLocalSecret={Boolean(session?.signingSecret)}
              onPropose={onProposeSettlement}
              onSignLocal={onSignWithLocalSecret}
              onAttachPaste={() => onAttachSignedPsbt(pastedPsbt)}
              onFinalize={onFinalizeSettlement}
              onConfirm={onConfirmSettlement}
            />
          ) : null}

          <div className="mt-6 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
            <h2 className="font-[family-name:var(--font-display)] text-xl">Evidence</h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Text evidence only for now — file uploads use the same API once storage is configured.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {(evidenceQuery.data ?? []).map((item) => (
                <li key={item.id} className="rounded border border-[var(--line)] p-2">
                  <p className="text-xs uppercase tracking-[0.1em] text-[var(--accent-soft)]">
                    {item.kind}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-all">{item.content}</p>
                  <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
                    {item.submitted_by.slice(0, 10)}… · {new Date(item.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
              {evidenceQuery.isSuccess && !evidenceQuery.data?.length ? (
                <li className="text-xs text-[var(--ink-muted)]">No evidence submitted yet.</li>
              ) : null}
            </ul>
            {isParty ? (
              <div className="mt-4 flex flex-col gap-2">
                <Input label="Kind" value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)} />
                <Textarea
                  label="Evidence"
                  value={evidenceContent}
                  onChange={(e) => setEvidenceContent(e.target.value)}
                  placeholder="Describe what happened, link a photo host, etc."
                />
                <button
                  type="button"
                  disabled={evidenceBusy || !evidenceContent.trim()}
                  onClick={onSubmitEvidence}
                  className="w-fit rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
                >
                  {evidenceBusy ? "Submitting…" : "Submit evidence"}
                </button>
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <ActionButton
              label="Prepare funding"
              disabled={!canFund}
              onClick={() => withSession((t) => prepareFunding(t, id))}
            />
            <ActionButton
              label="Verify funding"
              disabled={!agreedOrLater}
              onClick={() => withSession((t) => verifyFunding(t, id))}
            />
            <ActionButton
              label="Mark shipped"
              disabled={deal?.status !== "funded"}
              onClick={() => withSession((t) => transitionDeal(t, id, "shipped" as DealStatus))}
            />
            <ActionButton
              label="Accept delivery"
              disabled={deal?.status !== "shipped"}
              onClick={() => withSession((t) => transitionDeal(t, id, "accepted" as DealStatus))}
            />
            <ActionButton
              label="Open dispute"
              disabled={!deal || ["draft", "settled", "cancelled", "refunded"].includes(deal.status)}
              onClick={() =>
                withSession((t) => openDispute(t, id, "Item arrived damaged / not as described"))
              }
            />
            <ActionButton
              label="Export receipt"
              onClick={async () => {
                setError(null);
                try {
                  const receipt = await getReceipt(id);
                  setReceiptJson(JSON.stringify(receipt, null, 2));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "receipt failed");
                }
              }}
            />
          </div>

          {receiptJson ? (
            <pre className="mt-6 max-h-80 overflow-auto rounded border border-[var(--line)] bg-[var(--bg-deep)]/80 p-3 text-[11px] text-[var(--ink-muted)]">
              {receiptJson}
            </pre>
          ) : null}
        </section>

        <section className="animate-rise-delay">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Timeline</h2>
          <ol className="mt-4 space-y-3 border-l border-[var(--line)] pl-4">
            {(eventsQuery.data ?? []).map((event) => (
              <li key={event.sequence} className="text-sm">
                <p className="text-[var(--accent-soft)]">
                  #{event.sequence} · {String(event.kind)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {new Date(event.created_at).toLocaleString()}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] opacity-60">
                  {event.actor_pubkey.slice(0, 16)}…
                </p>
              </li>
            ))}
            {!eventsQuery.data?.length ? (
              <li className="text-sm text-[var(--ink-muted)]">No events yet.</li>
            ) : null}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}

function latestSettlementPurpose(events: DealEvent[] | undefined): string | null {
  if (!events?.length) {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const payload = events[i]?.payload as { type?: string; purpose?: string } | null;
    if (payload?.type === "settlement_proposed" && payload.purpose) {
      return payload.purpose;
    }
  }
  return null;
}

function SettlementPanel({
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
}: {
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
  psbtReview: {
    summary: ReturnType<typeof summarizePsbt> | null;
    error: string | null;
  } | null;
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
}) {
  const hasPsbt = Boolean(deal.current_psbt);
  const summary = psbtReview?.summary;
  const canAct = isParty && hasPsbt && !deal.settlement_txid && !declined;
  const requiredSignatures = settlement?.required_signatures ?? 2;
  const validSignatures = settlement?.valid_signatures ?? summary?.partial_sigs_total ?? 0;
  const phase = settlement?.phase ?? deal.settlement_phase;
  const canCheckConfirmation =
    isParty && Boolean(deal.settlement_txid) && phase !== "confirmed";

  return (
    <div className="mt-6 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
      <h2 className="font-[family-name:var(--font-display)] text-xl">Settlement PSBT</h2>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        Review outputs and fee before you sign. Keys never leave your browser; the API only
        combines PSBT updates.
      </p>

      {canPropose && !hasPsbt ? (
        <div className="mt-4 space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Purpose</span>
            <select
              className="rounded border border-[var(--line)] bg-[var(--bg-deep)]/60 px-3 py-2"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as SettlementPurpose)}
            >
              <option value="payout_seller">Payout seller</option>
              <option value="refund_buyer">Refund buyer</option>
            </select>
          </label>
          <Input
            label="Destination address"
            mono
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="bcrt1…"
          />
          <Input
            label="Fee (sats)"
            type="number"
            min={200}
            value={feeSats}
            onChange={(e) => setFeeSats(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onPropose}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
          >
            {busy ? "Proposing…" : "Propose settlement"}
          </button>
        </div>
      ) : null}

      {!hasPsbt && !canPropose ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          {deal.settlement_txid
            ? "Settlement already broadcast."
            : "Fund the deal before proposing a settlement PSBT."}
        </p>
      ) : null}

      {hasPsbt && summary ? (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Purpose:{" "}
            <span className="text-[var(--accent-soft)]">{purposeLabel(proposedPurpose)}</span>
          </p>
          <p className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-soft)]">
            This {proposedPurpose === "refund_buyer" ? "refunds the buyer" : "pays the seller"}.
            OpenDeal cannot verify that the destination address below belongs to that party —
            confirm it with them out of band before you sign.
          </p>
          <p className="break-all font-mono text-[10px] text-[var(--ink-muted)]">
            unsigned txid · {summary.unsigned_txid}
          </p>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Inputs</p>
            <ul className="mt-1 space-y-1">
              {summary.inputs.map((input) => (
                <li key={`${input.txid}:${input.vout}`} className="break-all font-mono text-[11px]">
                  {input.txid}:{input.vout}
                  {input.amount_sats != null
                    ? ` · ${input.amount_sats.toLocaleString()} sats`
                    : ""}
                  {input.partial_sigs > 0 ? ` · ${input.partial_sigs} sig(s)` : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Outputs</p>
            <ul className="mt-1 space-y-1">
              {summary.outputs.map((output, idx) => (
                <li key={`${output.script_hex}:${idx}`} className="break-all font-mono text-[11px]">
                  {output.address ?? `script:${output.script_hex.slice(0, 20)}…`} ·{" "}
                  {output.amount_sats.toLocaleString()} sats
                </li>
              ))}
            </ul>
          </div>
          <p>
            Fee:{" "}
            <span className="text-[var(--ok)]">{summary.fee_sats.toLocaleString()} sats</span>
            {" · "}
            Partial sigs: {validSignatures}/{requiredSignatures} needed
          </p>
          <p>
            Phase: <span className="text-[var(--accent-soft)]">{phase}</span>
            {settlement ? ` · ${settlement.confirmations} confirmation(s)` : null}
          </p>
          {deal.funding_amount_sats != null && summary.outputs[0] ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Check: funding {deal.funding_amount_sats.toLocaleString()} − fee{" "}
              {summary.fee_sats.toLocaleString()} ={" "}
              {(deal.funding_amount_sats - summary.fee_sats).toLocaleString()} (output{" "}
              {summary.outputs[0].amount_sats.toLocaleString()})
            </p>
          ) : null}

          {declined ? (
            <p className="text-sm text-[var(--danger)]">
              You declined to sign this PSBT. Do not attach a signature until a new proposal
              matches what you expect.
            </p>
          ) : (
            <>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  I reviewed the purpose, destination, output amount, and fee. I understand
                  signing moves escrow with 2-of-3.
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canAct || !reviewed || busy || !hasLocalSecret}
                  onClick={onSignLocal}
                  className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
                >
                  {busy ? "Signing…" : "Sign with local secret"}
                </button>
                <button
                  type="button"
                  disabled={!canAct || busy}
                  onClick={() => setDeclined(true)}
                  className="rounded border border-[var(--danger)]/50 px-4 py-2 text-sm text-[var(--danger)] disabled:opacity-40"
                >
                  Decline to sign
                </button>
                <button
                  type="button"
                  disabled={
                    !isParty ||
                    busy ||
                    Boolean(deal.settlement_txid) ||
                    validSignatures < requiredSignatures
                  }
                  onClick={onFinalize}
                  title={
                    validSignatures < requiredSignatures
                      ? `Needs ${requiredSignatures} of 3 signatures before it can be finalized`
                      : undefined
                  }
                  className="rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
                >
                  Finalize / broadcast
                </button>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-[var(--ink-muted)]">Or paste a wallet-signed PSBT</span>
                <textarea
                  className="min-h-20 rounded border border-[var(--line)] bg-[var(--bg-deep)]/60 px-3 py-2 font-mono text-[10px]"
                  value={pastedPsbt}
                  onChange={(e) => setPastedPsbt(e.target.value)}
                  placeholder="cHNidP…"
                />
              </label>
              <button
                type="button"
                disabled={!canAct || !reviewed || busy || !pastedPsbt.trim()}
                onClick={onAttachPaste}
                className="rounded border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40"
              >
                Attach pasted PSBT
              </button>
            </>
          )}
          {declined ? (
            <button
              type="button"
              className="mt-2 text-xs text-[var(--accent-soft)] underline"
              onClick={() => setDeclined(false)}
            >
              Reconsider
            </button>
          ) : null}
          <details className="text-xs text-[var(--ink-muted)]">
            <summary className="cursor-pointer">Raw PSBT</summary>
            <pre className="mt-2 max-h-40 overflow-auto break-all font-mono text-[10px]">
              {deal.current_psbt}
            </pre>
          </details>
        </div>
      ) : null}

      {hasPsbt && psbtReview?.error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">PSBT decode failed: {psbtReview.error}</p>
      ) : null}

      {deal.settlement_txid ? (
        <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
          <p className="break-all font-mono text-[10px] text-[var(--ink-muted)]">
            settlement txid · {deal.settlement_txid}
          </p>
          <p>
            Status: <span className="text-[var(--accent-soft)]">{phase}</span>
            {" · "}
            {(settlement?.confirmations ?? deal.settlement_confirmations)} confirmation(s)
          </p>
          {canCheckConfirmation ? (
            <>
              <Input
                label="Block hash (only needed without Core txindex)"
                mono
                value={confirmBlockHash}
                onChange={(e) => setConfirmBlockHash(e.target.value)}
                placeholder="optional"
              />
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                {busy ? "Checking…" : "Check confirmation"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {label}
    </button>
  );
}
