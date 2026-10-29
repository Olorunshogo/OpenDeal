"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DealLifecycleGuide } from "@/components/DealLifecycleGuide";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import {
  ApiRequestError,
  attachPsbtSignature,
  confirmSettlement,
  downloadEvidenceContent,
  finalizeSettlement,
  getAgreement,
  getDeal,
  getEvents,
  getFundingInstructions,
  getMeta,
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
  type Evidence,
  type FundingInstructions,
  type SettlementProgress,
  type SettlementPurpose,
} from "@/lib/api";
import { normPubkey, signCanonicalBytes } from "@/lib/crypto";
import {
  purposeLabel,
  signPsbtWithSecret,
  summarizePsbt,
  unsignedPsbtTxid,
  validateSettlementPsbt,
  type SettlementPsbtPolicy,
} from "@/lib/psbt";
import {
  getSigningCapability,
  loadSession,
  useHasSigningCapability,
  useSession,
} from "@/lib/session";
import { verifyCanonicalAgreement } from "@/lib/agreement-verification";
import { verifyDealReceipt, type ReceiptVerification } from "@/lib/receipt-verification";
import { canParticipantAct, participantRoleForAgreement } from "@/lib/workflow";
import { assertEvidenceIntegrity } from "@/lib/evidence";

export function DealDetailClient({ dealId }: { dealId?: string } = {}) {
  const Shell = AppShell;
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = dealId ?? params.id;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [receiptJson, setReceiptJson] = useState<string | null>(null);
  const [receiptVerification, setReceiptVerification] = useState<ReceiptVerification | null>(null);
  const [receiptViewer, setReceiptViewer] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const session = useSession();
  const hasSigningCapability = useHasSigningCapability(session?.pubkey);
  const [purpose, setPurpose] = useState<SettlementPurpose>(() => {
    const fromMediator = searchParams.get("purpose");
    return fromMediator === "payout_seller" || fromMediator === "refund_buyer"
      ? fromMediator
      : "payout_seller";
  });
  const [destination, setDestination] = useState("");
  const [feeSats, setFeeSats] = useState("500");
  const [pastedPsbt, setPastedPsbt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [confirmBlockHash, setConfirmBlockHash] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("note");
  const [evidenceContent, setEvidenceContent] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [downloadingEvidenceId, setDownloadingEvidenceId] = useState<string | null>(null);
  const [evidenceDownloadError, setEvidenceDownloadError] = useState<string | null>(null);
  const [escrowCopyState, setEscrowCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const token: string = session?.token ?? "";
  const viewer: string | undefined = session?.pubkey;

  const dealQuery = useQuery({
    queryKey: ["deal", id, viewer],
    queryFn: () => getDeal(token, id),
    enabled: Boolean(id && token),
  });
  const agreementQuery = useQuery({
    queryKey: ["agreement", id, viewer],
    queryFn: () => getAgreement(token, id),
    enabled: Boolean(id && token),
  });
  const eventsQuery = useQuery({
    queryKey: ["events", id, viewer],
    queryFn: () => getEvents(token, id),
    enabled: Boolean(id && token),
  });
  const evidenceQuery = useQuery({
    queryKey: ["evidence", id, viewer],
    queryFn: () => listEvidence(token, id),
    enabled: Boolean(id && token),
  });
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
  });
  const fundingQuery = useQuery({
    queryKey: ["funding", id, viewer],
    queryFn: () => getFundingInstructions(token, id),
    enabled: Boolean(token && dealQuery.data?.escrow_address),
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
    queryKey: ["settlement", id, viewer],
    queryFn: () => getSettlement(token, id),
    enabled: Boolean(token) && Boolean(dealQuery.data?.current_psbt),
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
    await queryClient.invalidateQueries({ queryKey: ["funding", id] });
  }

  async function onDownloadEvidence(item: Evidence) {
    setEvidenceDownloadError(null);
    const current = loadSession();
    if (!current?.token) {
      setEvidenceDownloadError("Sign in first (Sign in page).");
      return;
    }
    setDownloadingEvidenceId(item.id);
    try {
      const blob = await downloadEvidenceContent(current.token, id, item.id);
      await assertEvidenceIntegrity(blob, item.content_sha256);
      saveBlobAsFile(blob, evidenceFileName(item));
    } catch (err) {
      setEvidenceDownloadError(err instanceof Error ? err.message : "evidence download failed");
    } finally {
      setDownloadingEvidenceId(null);
    }
  }

  async function onCopyEscrowAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setEscrowCopyState("copied");
    } catch {
      setEscrowCopyState("failed");
    }
    setTimeout(() => setEscrowCopyState("idle"), 1500);
  }

  async function onExportReceipt() {
    setError(null);
    const current = loadSession();
    if (!current?.token) {
      setError("Sign in first (Sign in page).");
      return;
    }
    try {
      const receipt = await getReceipt(current.token, id);
      setReceiptJson(JSON.stringify(receipt, null, 2));
      setReceiptVerification(verifyDealReceipt(receipt));
      setReceiptViewer(current.pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "receipt failed");
    }
  }

  async function onConfirmSettlement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (Sign in page).");
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
      setError("Sign in first (Sign in page).");
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
    if (actionBusy) {
      return;
    }
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (Sign in page).");
      return;
    }
    setActionBusy(true);
    try {
      await action(session.token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function onSignAgreement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (Sign in page).");
      return;
    }
    const signingSecret = getSigningCapability(session.pubkey);
    if (!signingSecret) {
      setError(
        "No signing key unlocked in this tab. Unlock your identity on the Sign in page.",
      );
      return;
    }
    const agreement = agreementQuery.data;
    if (!agreement) {
      setError("Agreement not loaded yet.");
      return;
    }
    if (!agreementVerification?.valid) {
      setError(agreementVerification?.error ?? "Agreement verification is still pending.");
      return;
    }
    setSigning(true);
    try {
      const signature = signCanonicalBytes(signingSecret, agreement.canonical_hex);
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
  const agreementVerification =
    deal && agreement
      ? verifyCanonicalAgreement(agreement.canonical_hex, agreement.agreement, deal)
      : null;
  const signed = new Set((agreement?.signed_pubkeys ?? []).map(normPubkey));
  const sellerSigned = agreement
    ? signed.has(normPubkey(agreement.agreement.seller_pubkey))
    : false;
  const buyerSigned = agreement
    ? signed.has(normPubkey(agreement.agreement.buyer_pubkey))
    : false;
  const participantRole = participantRoleForAgreement(session?.pubkey, agreement?.agreement);
  const isBuyerOrSeller = participantRole === "buyer" || participantRole === "seller";
  const isParty = participantRole !== "other";
  const alreadySigned = session ? signed.has(normPubkey(session.pubkey)) : false;
  const canSign =
    canParticipantAct("sign", String(deal?.status ?? ""), participantRole) &&
    Boolean(isBuyerOrSeller) &&
    !alreadySigned &&
    hasSigningCapability &&
    agreementVerification?.valid === true;
  const canOpenDispute = canParticipantAct(
    "open_dispute",
    String(deal?.status ?? ""),
    participantRole,
    Boolean(deal?.settlement_txid || deal?.current_psbt),
  );
  const canFund =
    deal?.status === "agreed" || deal?.status === "awaiting_payment";
  const disputeDecision = latestDisputeDecision(eventsQuery.data);
  const authorizedPurpose: SettlementPurpose | null =
    deal?.status === "accepted"
      ? "payout_seller"
      : deal?.status === "disputed" && disputeDecision === "release"
        ? "payout_seller"
        : deal?.status === "disputed" && disputeDecision === "refund"
          ? "refund_buyer"
          : null;
  const canPropose =
    Boolean(isParty) &&
    Boolean(deal?.funding_txid) &&
    !deal?.settlement_txid &&
    Boolean(authorizedPurpose) &&
    purpose === authorizedPurpose;

  const proposedPurpose = useMemo(
    () => latestSettlementPurpose(eventsQuery.data),
    [eventsQuery.data],
  );

  const settlementPolicyResult = useMemo((): {
    policy: SettlementPsbtPolicy | null;
    error: string | null;
  } => {
    if (!deal?.settlement_proposal) {
      return { policy: null, error: null };
    }
    if (!agreementVerification?.valid) {
      return { policy: null, error: "The canonical agreement is not verified." };
    }
    if (!fundingQuery.data || !metaQuery.data) {
      return { policy: null, error: "Funding scripts or fee policy are still loading." };
    }
    if (
      !deal.funding_txid ||
      deal.funding_vout === null ||
      deal.funding_amount_sats === null ||
      fundingQuery.data.address !== deal.escrow_address ||
      fundingQuery.data.expected_amount_sats !== deal.amount_sats ||
      deal.funding_amount_sats < fundingQuery.data.expected_amount_sats ||
      fundingQuery.data.network !== deal.network ||
      metaQuery.data.network !== deal.network
    ) {
      return {
        policy: null,
        error: "Funding instructions do not match the loaded deal and API network.",
      };
    }
    const payout = deal.settlement_purpose === "payout_seller";
    const refund = deal.settlement_purpose === "refund_buyer";
    const authorizedDestination = payout
      ? agreementVerification.agreement.seller_payout_address
      : refund
        ? agreementVerification.agreement.buyer_refund_address
        : undefined;
    if (!authorizedDestination) {
      return {
        policy: null,
        error: "Settlement purpose has no destination in the verified signed agreement.",
      };
    }
    try {
      return {
        policy: {
          network: deal.network,
          expected_unsigned_txid: unsignedPsbtTxid(deal.settlement_proposal),
          funding_txid: deal.funding_txid,
          funding_vout: deal.funding_vout,
          funding_amount_sats: deal.funding_amount_sats,
          script_pubkey_hex: fundingQuery.data.script_pubkey_hex,
          witness_script_hex: fundingQuery.data.witness_script_hex,
          destination_address: authorizedDestination,
          participant_pubkeys: [
            agreementVerification.agreement.buyer_pubkey,
            agreementVerification.agreement.seller_pubkey,
            agreementVerification.agreement.mediator_pubkey,
          ],
          min_fee_sats: 200,
          max_fee_sats: metaQuery.data.bitcoin_max_fee_sats,
          max_fee_bps: metaQuery.data.bitcoin_max_fee_bps,
        },
        error: null,
      };
    } catch (policyError) {
      return {
        policy: null,
        error: policyError instanceof Error ? policyError.message : "Could not build settlement policy.",
      };
    }
  }, [deal, agreementVerification, fundingQuery.data, metaQuery.data]);
  const settlementPolicy = settlementPolicyResult.policy;

  const currentPsbt = deal?.current_psbt;
  const psbtReview = useMemo(() => {
    if (!currentPsbt) {
      return null;
    }
    if (!settlementPolicy) {
      return {
        summary: null,
        error: settlementPolicyResult.error ?? "The immutable settlement policy is unavailable; signing is disabled.",
      };
    }
    try {
      return {
        summary: summarizePsbt(currentPsbt, settlementPolicy),
        error: null as string | null,
      };
    } catch (err) {
      return {
        summary: null,
        error: err instanceof Error ? err.message : "failed to decode PSBT",
      };
    }
  }, [currentPsbt, settlementPolicy, settlementPolicyResult.error]);

  // Reset the review state while rendering when a new PSBT arrives, instead of in an effect
  const [reviewedForPsbt, setReviewedForPsbt] = useState<string | null | undefined>(currentPsbt);
  if (reviewedForPsbt !== currentPsbt) {
    setReviewedForPsbt(currentPsbt);
    setReviewed(false);
    setDeclined(false);
    setPastedPsbt("");
  }

  async function onProposeSettlement() {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Sign in first (Sign in page).");
      return;
    }
    const fee = Number(feeSats);
    if (!destination.trim()) {
      setError("Destination address is required.");
      return;
    }
    const signedDestination =
      purpose === "payout_seller"
        ? agreementVerification?.valid && agreementVerification.agreement.seller_payout_address
        : agreementVerification?.valid && agreementVerification.agreement.buyer_refund_address;
    if (!signedDestination || destination.trim() !== signedDestination) {
      setError("Destination must exactly match the address in the verified signed agreement.");
      return;
    }
    const fundingAmount = deal?.funding_amount_sats;
    const feeBigInt = BigInt(Number.isSafeInteger(fee) ? fee : 0);
    const maxByBps =
      (fundingAmount && metaQuery.data
        ? (BigInt(fundingAmount) * BigInt(metaQuery.data.bitcoin_max_fee_bps)) / BigInt(10_000)
        : BigInt(0));
    if (
      !Number.isSafeInteger(fee) ||
      fee < 200 ||
      !fundingAmount ||
      !metaQuery.data ||
      feeBigInt > BigInt(metaQuery.data.bitcoin_max_fee_sats) ||
      feeBigInt > maxByBps ||
      feeBigInt >= BigInt(fundingAmount)
    ) {
      setError("Fee is outside the configured absolute or relative settlement policy.");
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
      setError("Sign in first (Sign in page).");
      return;
    }
    if (!reviewed) {
      setError("Confirm you reviewed outputs and fee before attaching a signature.");
      return;
    }
    if (!settlementPolicy) {
      setError("The immutable settlement policy is unavailable; signing is disabled.");
      return;
    }
    try {
      const signedSummary = validateSettlementPsbt(signedPsbt.trim(), settlementPolicy, session.pubkey);
      if (
        !signedSummary.partial_sig_pubkeys.some(
          (pubkey) => normPubkey(pubkey) === normPubkey(session.pubkey),
        )
      ) {
        throw new Error("Pasted PSBT does not contain a signature for the authenticated identity.");
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "PSBT validation failed.");
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
      setError("Sign in first (Sign in page).");
      return;
    }
    const signingSecret = getSigningCapability(session.pubkey);
    if (!signingSecret) {
      setError("No local signing secret for PSBT signing.");
      return;
    }
    if (!deal?.current_psbt) {
      setError("No settlement PSBT to sign.");
      return;
    }
    if (!settlementPolicy) {
      setError("The immutable settlement policy is unavailable; signing is disabled.");
      return;
    }
    if (!reviewed) {
      setError("Confirm you reviewed outputs and fee before signing.");
      return;
    }
    setSettlementBusy(true);
    try {
      const signed = signPsbtWithSecret(
        deal.current_psbt,
        signingSecret,
        settlementPolicy,
        session.pubkey,
      );
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
      setError("Sign in first (Sign in page).");
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

  if (!token) {
    return (
      <Shell>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 animate-rise">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deal</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            {session ? "Your sign-in expired" : "Sign in to view this deal"}
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {session
              ? "Use Sign in again in the footer to pick up where you left off."
              : "Only the seller, buyer, or mediator on this deal can open it."}
          </p>
          <a
            href={`/onboarding?next=${encodeURIComponent(`/deals/${id}`)}`}
            className="w-full rounded bg-[var(--accent)] px-4 py-2 text-center text-sm font-semibold text-[var(--bg-deep)] sm:w-fit"
          >
            Sign in
          </a>
        </div>
      </Shell>
    );
  }

  const dealAccessError: ApiRequestError | null =
    dealQuery.error instanceof ApiRequestError ? dealQuery.error : null;
  if (dealAccessError?.status === 403 || dealAccessError?.status === 404) {
    return (
      <Shell>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 animate-rise">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deal</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            {dealAccessError.status === 403 ? "Not a party to this deal" : "Deal not found"}
          </h1>
          <p className="text-sm text-[var(--ink-muted)]">
            {dealAccessError.status === 403
              ? "The signed-in identity is not the seller, buyer, or mediator here. Switch to the right identity in the footer."
              : "Check the deal link and try again."}
          </p>
        </div>
      </Shell>
    );
  }

  const funding: FundingInstructions | undefined = fundingQuery.data;

  return (
    <Shell>
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="flex min-w-0 flex-col gap-6 animate-rise">
          <NetworkBanner network={deal?.network} />
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deal</p>
            <h1 className="break-words font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
              {deal?.title ?? "Loading…"}
            </h1>
          </div>
          {deal ? <DealLifecycleGuide deal={deal} role={participantRole} sellerSigned={sellerSigned} buyerSigned={buyerSigned} validSignatures={settlementQuery.data?.valid_signatures ?? 0} disputeResolved={Boolean(disputeDecision)} /> : null}
          {dealQuery.isError && !dealAccessError ? (
            <p className="text-sm text-[var(--danger)]">
              {dealQuery.error instanceof Error ? dealQuery.error.message : "Could not load this deal."}
            </p>
          ) : null}
          {deal ? (
            <div className="flex flex-col gap-2 text-sm text-[var(--ink-muted)]">
              <p>
                Status: <span className="text-[var(--ok)]">{deal.status}</span>
              </p>
              {agreement ? (
                <p>
                  Your role in this deal: {participantRole === "other" ? "not a participant" : participantRole}
                </p>
              ) : null}
              <p>
                Settlement:{" "}
                <span className="break-all text-[var(--accent-soft)]">{deal.settlement_model}</span>
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
            <div className="flex flex-col gap-3 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-[family-name:var(--font-display)] text-xl">Agreement</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Buyer and seller must both sign the same canonical bytes before funding.
                </p>
              </div>
              {agreementVerification?.valid ? (
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div className="flex flex-col gap-0.5 sm:col-span-2">
                    <dt className="text-xs text-[var(--ink-muted)]">Title</dt>
                    <dd className="break-words">{agreementVerification.agreement.title}</dd>
                  </div>
                  {agreementVerification.agreement.description ? (
                    <div className="flex flex-col gap-0.5 sm:col-span-2">
                      <dt className="text-xs text-[var(--ink-muted)]">Description</dt>
                      <dd className="whitespace-pre-wrap break-words">
                        {agreementVerification.agreement.description}
                      </dd>
                    </div>
                  ) : null}
                  <AgreementTerm label="Amount">
                    {agreementVerification.agreement.amount_sats.toLocaleString()} sats
                  </AgreementTerm>
                  <AgreementTerm label="Currency">{agreementVerification.agreement.currency}</AgreementTerm>
                  <AgreementTerm label="Seller public key" mono>
                    {agreementVerification.agreement.seller_pubkey}
                  </AgreementTerm>
                  <AgreementTerm label="Buyer public key" mono>
                    {agreementVerification.agreement.buyer_pubkey}
                  </AgreementTerm>
                  <AgreementTerm label="Mediator public key" mono>
                    {agreementVerification.agreement.mediator_pubkey}
                  </AgreementTerm>
                  <AgreementTerm label="Seller payout address" mono>
                    {agreementVerification.agreement.seller_payout_address}
                  </AgreementTerm>
                  <AgreementTerm label="Buyer refund address" mono>
                    {agreementVerification.agreement.buyer_refund_address}
                  </AgreementTerm>
                  <AgreementTerm label="Delivery deadline">
                    {agreementVerification.agreement.delivery_deadline}
                  </AgreementTerm>
                  <AgreementTerm label="Acceptance window">
                    {agreementVerification.agreement.acceptance_window_hours} hours
                  </AgreementTerm>
                  <AgreementTerm label="Settlement model">
                    {agreementVerification.agreement.settlement_model}
                  </AgreementTerm>
                  <AgreementTerm label="Network">{agreementVerification.agreement.network}</AgreementTerm>
                  <AgreementTerm label="Agreement version">
                    {agreementVerification.agreement.version}
                  </AgreementTerm>
                  <AgreementTerm label="Created at">
                    {agreementVerification.agreement.created_at}
                  </AgreementTerm>
                  <div className="flex flex-col gap-0.5 sm:col-span-2">
                    <dt className="text-xs text-[var(--ink-muted)]">Dispute eligibility</dt>
                    <dd className="text-xs text-[var(--ink-muted)]">
                      A party may open a dispute while funded, shipped, or accepted, before a
                      settlement proposal is made. This is protocol policy, not an agreement deadline.
                    </dd>
                  </div>
                </dl>
              ) : agreementVerification ? (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  Agreement verification failed: {agreementVerification.error} Signing is disabled.
                </p>
              ) : (
                <p className="text-sm text-[var(--ink-muted)]">Verifying canonical agreement…</p>
              )}
              <ul className="flex flex-col gap-1 text-sm">
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
              <p className="break-all font-mono text-[10px] text-[var(--ink-muted)]">
                verified sha256 · {agreementVerification?.valid ? agreementVerification.digest : "not verified"}
              </p>
              {deal?.status === "draft" ? (
                <button
                  type="button"
                  disabled={!canSign || signing}
                  onClick={onSignAgreement}
                  className="w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40 sm:w-fit"
                >
                  {signing
                    ? "Signing…"
                    : alreadySigned
                      ? "You already signed"
                      : "Sign agreement"}
                </button>
              ) : (
                <p className="text-sm text-[var(--ok)]">Agreement complete ({deal?.status}).</p>
              )}
            </div>
          ) : null}

          {deal?.escrow_address ? (
            <div className="flex flex-col gap-3 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
              <div className="flex flex-col gap-1">
                <h2 className="font-[family-name:var(--font-display)] text-xl">Funding instructions</h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  Send exactly the expected amount to the 2-of-3 escrow address, then use Verify funding.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 break-all rounded border border-[var(--line)] bg-[var(--bg-deep)]/60 px-3 py-2 font-mono text-xs text-[var(--ink)]">
                  {funding?.address ?? deal.escrow_address}
                </p>
                <button
                  type="button"
                  onClick={() => onCopyEscrowAddress(funding?.address ?? deal.escrow_address!)}
                  className="rounded border border-[var(--line)] px-3 py-2 text-xs hover:border-[var(--accent)]"
                >
                  {escrowCopyState === "copied"
                    ? "Copied"
                    : escrowCopyState === "failed"
                      ? "Copy failed"
                      : "Copy address"}
                </button>
              </div>
              {funding ? (
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-[var(--ink-muted)]">Expected amount</dt>
                    <dd>
                      {funding.expected_amount_sats.toLocaleString()} sats
                      <span className="block font-mono text-xs text-[var(--ink-muted)]">
                        {satsToBtc(funding.expected_amount_sats)} BTC
                      </span>
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-[var(--ink-muted)]">Confirmations needed</dt>
                    <dd>{funding.required_confirmations}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-[var(--ink-muted)]">Network</dt>
                    <dd className="network-badge text-[var(--accent-soft)]">{funding.network}</dd>
                  </div>
                </dl>
              ) : null}
              {fundingQuery.isError ? (
                <p className="text-sm text-[var(--danger)]">
                  {fundingQuery.error instanceof Error
                    ? fundingQuery.error.message
                    : "Could not load funding instructions."}
                </p>
              ) : null}
              {funding ? (
                <details className="text-xs text-[var(--ink-muted)]">
                  <summary className="cursor-pointer">Technical details</summary>
                  <div className="flex flex-col gap-2 pt-2">
                    <p className="break-all font-mono text-[10px]">
                      scriptPubKey · {funding.script_pubkey_hex}
                    </p>
                    <p className="break-all font-mono text-[10px]">
                      witness script · {funding.witness_script_hex}
                    </p>
                  </div>
                </details>
              ) : null}
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
              settlementPolicy={settlementPolicy}
              authorizedDestination={settlementPolicy?.destination_address ?? null}
              reviewed={reviewed}
              setReviewed={setReviewed}
              declined={declined}
              setDeclined={setDeclined}
              pastedPsbt={pastedPsbt}
              setPastedPsbt={setPastedPsbt}
              confirmBlockHash={confirmBlockHash}
              setConfirmBlockHash={setConfirmBlockHash}
              busy={settlementBusy}
              hasLocalSecret={hasSigningCapability}
              onPropose={onProposeSettlement}
              onSignLocal={onSignWithLocalSecret}
              onAttachPaste={() => onAttachSignedPsbt(pastedPsbt)}
              onFinalize={onFinalizeSettlement}
              onConfirm={onConfirmSettlement}
            />
          ) : null}

          <div className="flex flex-col gap-3 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-[family-name:var(--font-display)] text-xl">Evidence</h2>
              <p className="text-xs text-[var(--ink-muted)]">
                Every item is stored with a SHA-256 hash. Download to inspect the original content.
              </p>
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {(evidenceQuery.data ?? []).map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 rounded border border-[var(--line)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs uppercase tracking-[0.1em] text-[var(--accent-soft)]">
                      {item.kind}
                    </p>
                    <span className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
                      {item.object_key ? "File" : "Text"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{item.content}</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="break-all text-[10px] text-[var(--ink-muted)]">
                      {item.submitted_by.slice(0, 10)}… · {new Date(item.created_at).toLocaleString()}
                      {item.content_sha256 ? (
                        <span title={item.content_sha256} className="font-mono">
                          {" · sha256 "}
                          {item.content_sha256.slice(0, 12)}…
                        </span>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      disabled={downloadingEvidenceId === item.id}
                      onClick={() => onDownloadEvidence(item)}
                      className="rounded border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--accent)] disabled:opacity-40"
                    >
                      {downloadingEvidenceId === item.id ? "Downloading…" : "Download"}
                    </button>
                  </div>
                </li>
              ))}
              {evidenceQuery.isSuccess && !evidenceQuery.data?.length ? (
                <li className="text-xs text-[var(--ink-muted)]">No evidence submitted yet.</li>
              ) : null}
            </ul>
            {evidenceDownloadError ? (
              <p className="text-sm text-[var(--danger)]">{evidenceDownloadError}</p>
            ) : null}
            {canParticipantAct("submit_evidence", String(deal?.status ?? ""), participantRole) ? (
              <div className="flex flex-col gap-2">
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
                  className="w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40 sm:w-fit"
                >
                  {evidenceBusy ? "Submitting…" : "Submit evidence"}
                </button>
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <ActionButton
              label="Prepare funding"
              disabled={actionBusy || !canFund}
              onClick={() => withSession((t) => prepareFunding(t, id))}
            />
            <ActionButton
              label="Verify funding"
              disabled={actionBusy || deal?.status !== "awaiting_payment"}
              onClick={() => withSession((t) => verifyFunding(t, id))}
            />
            <ActionButton
              label="Mark shipped"
              disabled={actionBusy || !canParticipantAct("ship", String(deal?.status ?? ""), participantRole)}
              onClick={() => withSession((t) => transitionDeal(t, id, "shipped" as DealStatus))}
            />
            <ActionButton
              label="Accept delivery"
              disabled={actionBusy || !canParticipantAct("accept", String(deal?.status ?? ""), participantRole)}
              onClick={() => withSession((t) => transitionDeal(t, id, "accepted" as DealStatus))}
            />
            {canOpenDispute ? (
              <Input
                label="Dispute reason"
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value)}
              />
            ) : null}
            <ActionButton
              label="Open dispute"
              disabled={actionBusy || !canOpenDispute || !disputeReason.trim()}
              onClick={() =>
                withSession((t) => openDispute(t, id, disputeReason.trim()))
              }
            />
            <ActionButton label="Export receipt" onClick={onExportReceipt} />
          </div>

          {receiptJson && receiptViewer === viewer ? (
            <div className="flex flex-col gap-3 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
              {receiptVerification?.valid ? (
                <div role="status" className="flex flex-col gap-2 text-sm">
                  <p className="text-[var(--ok)]">Receipt consistency checks passed.</p>
                  <ul className="list-disc pl-5 text-xs text-[var(--ink-muted)]">
                    {receiptVerification.checks.map((check) => <li key={check}>{check}</li>)}
                  </ul>
                  <p className="text-xs font-medium text-[var(--warn)]">
                    This does not independently prove current blockchain confirmation.
                  </p>
                  <ul className="list-disc pl-5 text-xs text-[var(--ink-muted)]">
                    {receiptVerification.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  Receipt verification failed: {receiptVerification?.error ?? "No result."}
                </p>
              )}
              <button
                type="button"
                onClick={() =>
                  saveBlobAsFile(
                    new Blob([receiptJson], { type: "application/json" }),
                    `receipt-${id.slice(0, 8)}.json`,
                  )
                }
                className="w-fit rounded border border-[var(--line)] px-3 py-2 text-xs hover:border-[var(--accent)]"
              >
                Download receipt JSON
              </button>
              <details>
                <summary className="cursor-pointer text-xs text-[var(--ink-muted)]">Receipt JSON</summary>
                <pre className="max-h-80 overflow-auto break-all rounded border border-[var(--line)] bg-[var(--bg-deep)]/80 p-3 text-[11px] text-[var(--ink-muted)]">
                  {receiptJson}
                </pre>
              </details>
            </div>
          ) : null}
        </section>

        <section className="flex min-w-0 flex-col gap-4 animate-rise-delay">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Timeline</h2>
          <ol className="flex flex-col gap-3 border-l border-[var(--line)] pl-4">
            {(eventsQuery.data ?? []).map((event) => (
              <li key={event.sequence} className="flex flex-col gap-1 text-sm">
                <p className="break-words text-[var(--accent-soft)]">
                  #{event.sequence} · {String(event.kind)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {new Date(event.created_at).toLocaleString()}
                </p>
                <p className="break-all font-mono text-[10px] opacity-60">
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
    </Shell>
  );
}

function AgreementTerm({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-[var(--ink-muted)]">{label}</dt>
      <dd className={`${mono ? "break-all font-mono text-xs" : "break-words"}`}>{children}</dd>
    </div>
  );
}

const EVIDENCE_EXTENSIONS: Record<string, string> = {
  "text/plain": "txt",
  "application/json": "json",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function evidenceFileName(item: Evidence): string {
  const contentType: string = item.object_key ? (item.content_type ?? "") : "text/plain";
  const extension: string = EVIDENCE_EXTENSIONS[contentType.split(";")[0].trim()] ?? "bin";
  return `evidence-${item.id.slice(0, 8)}.${extension}`;
}

function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url: string = URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8);
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

function latestDisputeDecision(events: DealEvent[] | undefined): "release" | "refund" | null {
  if (!events?.length) {
    return null;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index]?.payload as { type?: string; decision?: string } | null;
    if (payload?.type === "dispute_resolved") {
      return payload.decision === "release" || payload.decision === "refund"
        ? payload.decision
        : null;
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
    <div className="flex flex-col gap-4 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-[family-name:var(--font-display)] text-xl">Settlement PSBT</h2>
        <p className="text-xs text-[var(--ink-muted)]">
          Review outputs and fee before you sign. Keys never leave your browser; the API only
          combines PSBT updates.
        </p>
      </div>

      {canPropose && !hasPsbt ? (
        <div className="flex flex-col gap-3">
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
            className="w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40 sm:w-fit"
          >
            {busy ? "Proposing…" : "Propose settlement"}
          </button>
        </div>
      ) : null}

      {!hasPsbt && !canPropose ? (
        <p className="text-sm text-[var(--ink-muted)]">
          {deal.settlement_txid
            ? "Settlement already broadcast."
            : "Fund the deal before proposing a settlement PSBT."}
        </p>
      ) : null}

      {hasPsbt && summary ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Purpose:{" "}
            <span className="text-[var(--accent-soft)]">{purposeLabel(proposedPurpose)}</span>
          </p>
          <p className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs text-[var(--accent-soft)]">
            This {proposedPurpose === "refund_buyer" ? "refunds the buyer" : "pays the seller"}.
            The destination is checked against the signed agreement. Independently confirm the
            address with the recipient before signing.
          </p>
          <p className="break-all font-mono text-xs text-[var(--ink)]">
            Signed destination · {authorizedDestination ?? "unavailable"}
          </p>
          <p className="break-all font-mono text-[10px] text-[var(--ink-muted)]">
            unsigned txid · {summary.unsigned_txid}
          </p>
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Inputs</p>
            <ul className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">Outputs</p>
            <ul className="flex flex-col gap-1">
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
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  I reviewed the purpose, destination, output amount, and fee. I understand
                  signing moves escrow with 2-of-3.
                </span>
              </label>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <button
                  type="button"
                  disabled={!canAct || !reviewed || busy || !hasLocalSecret || !settlementPolicy}
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
                disabled={!canAct || !reviewed || busy || !pastedPsbt.trim() || !settlementPolicy}
                onClick={onAttachPaste}
                className="w-full rounded border border-[var(--line)] px-3 py-2 text-xs disabled:opacity-40 sm:w-fit"
              >
                Attach pasted PSBT
              </button>
            </>
          )}
          {declined ? (
            <button
              type="button"
              className="w-fit text-xs text-[var(--accent-soft)] underline"
              onClick={() => setDeclined(false)}
            >
              Reconsider
            </button>
          ) : null}
          <details className="text-xs text-[var(--ink-muted)]">
            <summary className="cursor-pointer">Raw PSBT</summary>
            <pre className="max-h-40 whitespace-pre-wrap pt-2 overflow-auto break-all font-mono text-[10px]">
              {deal.current_psbt}
            </pre>
          </details>
        </div>
      ) : null}

      {hasPsbt && psbtReview?.error ? (
        <p className="text-sm text-[var(--danger)]">PSBT decode failed: {psbtReview.error}</p>
      ) : null}

      {deal.settlement_txid ? (
        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4 text-sm">
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
                className="w-full rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40 sm:w-fit"
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
      title={disabled ? `${label} is unavailable for the current identity or deal state. See the workflow guide above.` : undefined}
      className="rounded border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {label}
    </button>
  );
}
