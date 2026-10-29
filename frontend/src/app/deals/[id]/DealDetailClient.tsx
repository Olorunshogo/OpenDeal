"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileCheck2, PackageCheck, Scale, Truck, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DealLifecycleGuide } from "@/components/DealLifecycleGuide";
import { PageHeader } from "@/components/layout/PageHeader";
import { NetworkBanner } from "@/components/NetworkBanner";
import { UnlockSigningKey } from "@/components/UnlockSigningKey";
import {
  Alert,
  Amount,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  DataList,
  HashValue,
  Input,
  Skeleton,
  StatusBadge,
} from "@/components/ui";
import {
  ApiRequestError,
  attachPsbtSignature,
  confirmSettlement,
  finalizeSettlement,
  getAgreement,
  getDeal,
  getEvents,
  getFundingInstructions,
  getMeta,
  getReceipt,
  getSettlement,
  openDispute,
  prepareFunding,
  proposeSettlement,
  signAgreement,
  transitionDeal,
  verifyFunding,
  type DealEvent,
  type DealStatus,
  type SettlementPurpose,
} from "@/lib/api";
import { normPubkey, signCanonicalBytes } from "@/lib/crypto";
import {
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
import { actionBlockedReason, canParticipantAct, participantRoleForAgreement } from "@/lib/workflow";
import { errorMessage } from "@/lib/server-errors";
import { ActionButton } from "./ActionButton";
import { AgreementCard } from "./AgreementCard";
import { DataFreshness } from "./DataFreshness";
import { DealEvidencePanel } from "./DealEvidencePanel";
import { DealTimeline } from "./DealTimeline";
import { FundingCard } from "./FundingCard";
import { PartyReputation } from "./PartyReputation";
import { ReceiptPanel } from "./ReceiptPanel";
import { SettlementPanel } from "./SettlementPanel";

// The other participant acts in their own browser. Poll so this page picks up their changes
// without a reload, because a reload drops the in-memory signing key. Only the deal is polled
// (the API bumps updated_at on every event); the rest is refetched when it changes. That is one
// request per window every 5 s, well under the API's per-IP rate limit with two local windows.
const DEAL_POLL_MS = 5000;

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
  // null = use the address from the verified signed agreement for the chosen purpose.
  const [destinationInput, setDestinationInput] = useState<string | null>(null);
  const [feeSats, setFeeSats] = useState("500");
  const [pastedPsbt, setPastedPsbt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [confirmBlockHash, setConfirmBlockHash] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const token: string = session?.token ?? "";
  const viewer: string | undefined = session?.pubkey;

  const dealQuery = useQuery({
    queryKey: ["deal", id, viewer],
    queryFn: () => getDeal(token, id),
    enabled: Boolean(id && token),
    refetchInterval: DEAL_POLL_MS,
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
  const changeSignal = dealQuery.data
    ? `${dealQuery.data.updated_at}|${dealQuery.data.status}|${dealQuery.data.settlement_phase}`
    : "";
  const lastSignal = useRef("");
  useEffect(() => {
    const previous = lastSignal.current;
    lastSignal.current = changeSignal;
    // Skip the first load: those queries were just fetched.
    if (!changeSignal || !previous || previous === changeSignal) return;
    for (const key of ["agreement", "events", "settlement", "funding", "evidence"]) {
      void queryClient.invalidateQueries({ queryKey: [key, id] });
    }
  }, [changeSignal, id, queryClient]);
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
  });
  const fundingQuery = useQuery({
    queryKey: ["funding", id, viewer],
    queryFn: () => getFundingInstructions(token, id),
    enabled: Boolean(token && dealQuery.data?.escrow_address),
  });
  const settlementQuery = useQuery({
    // Keyed on the current PSBT so signature counts always describe the PSBT on screen.
    queryKey: ["settlement", id, viewer, psbtFingerprint(dealQuery.data?.current_psbt)],
    queryFn: () => getSettlement(token, id),
    enabled: Boolean(token) && Boolean(dealQuery.data?.current_psbt),
    // Refetched when the PSBT changes (key) or the deal changes (see the effect below).
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["deal", id] });
    await queryClient.invalidateQueries({ queryKey: ["agreement", id] });
    await queryClient.invalidateQueries({ queryKey: ["events", id] });
    await queryClient.invalidateQueries({ queryKey: ["settlement", id] });
    await queryClient.invalidateQueries({ queryKey: ["funding", id] });
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
  const agreedDestination =
    agreementVerification?.valid === true
      ? purpose === "payout_seller"
        ? agreementVerification.agreement.seller_payout_address
        : agreementVerification.agreement.buyer_refund_address
      : "";
  const destination = destinationInput ?? agreedDestination ?? "";
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
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 animate-rise">
          <PageHeader
            eyebrow="Deal"
            title={session ? "Your sign-in expired" : "Sign in to view this deal"}
            description={
              session
                ? "Use Sign in again in the footer to pick up where you left off."
                : "Only the seller, buyer, or mediator on this deal can open it."
            }
          />
          <ButtonLink href={`/onboarding?next=${encodeURIComponent(`/deals/${id}`)}`} className="w-full sm:w-fit">
            Sign in
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const dealAccessError: ApiRequestError | null =
    dealQuery.error instanceof ApiRequestError ? dealQuery.error : null;
  if (dealAccessError?.status === 403 || dealAccessError?.status === 404) {
    return (
      <Shell>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6 animate-rise">
          <PageHeader
            eyebrow="Deal"
            title={dealAccessError.status === 403 ? "Not a party to this deal" : "Deal not found"}
            description={
              dealAccessError.status === 403
                ? "The signed-in identity is not the seller, buyer, or mediator here. Switch to the right identity in the footer."
                : "Check the deal link and try again."
            }
          />
          <ButtonLink href="/deals" variant="secondary" className="w-full sm:w-fit">
            Back to my deals
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const status: string = String(deal?.status ?? "");
  const disputeBlocked: string | null =
    actionBlockedReason("open_dispute", status, participantRole, Boolean(deal?.settlement_txid || deal?.current_psbt)) ??
    (disputeReason.trim() ? null : "Enter a dispute reason first.");

  return (
    <Shell>
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <section className="flex min-w-0 flex-col gap-6 animate-rise">
          <NetworkBanner network={deal?.network} />
          <PageHeader
            eyebrow="Deal"
            title={deal?.title ?? "Loading…"}
            actions={deal ? <StatusBadge status={deal.status} className="text-sm" /> : null}
          />
          {deal ? (
            <DataFreshness
              updatedAt={dealQuery.dataUpdatedAt}
              fetching={dealQuery.isFetching}
              onRefresh={() => void refresh()}
            />
          ) : null}
          {dealQuery.isError && !dealAccessError ? (
            <Alert tone="danger">{errorMessage(dealQuery.error, "Could not load this deal.")}</Alert>
          ) : null}
          {!deal && dealQuery.isPending ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : null}

          {deal ? (
            <Card>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <Amount sats={deal.amount_sats} size="lg" />
                <div className="flex flex-wrap gap-2">
                  <Badge tone="violet">{deal.network}</Badge>
                  {agreement ? (
                    <Badge tone="brand">you: {participantRole === "other" ? "not a participant" : participantRole}</Badge>
                  ) : null}
                </div>
              </div>
              <DataList
                items={[
                  { label: "Settlement", value: <span className="break-all">{deal.settlement_model}</span> },
                  { label: "Currency", value: deal.currency },
                  ...(deal.funding_txid
                    ? [{ label: "Funding tx", value: <HashValue value={deal.funding_txid} />, wide: true }]
                    : []),
                  ...(deal.settlement_txid
                    ? [{ label: "Settlement tx", value: <HashValue value={deal.settlement_txid} />, wide: true }]
                    : []),
                  { label: "Deal id", value: <HashValue value={deal.id} head={12} />, wide: true },
                ]}
              />
              <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <PartyReputation sellerPubkey={deal.seller_pubkey} buyerPubkey={deal.buyer_pubkey} />
                <ButtonLink href={`/deals/${deal.id}/checkout`} variant="link" size="sm" className="w-fit">
                  Checkout view
                </ButtonLink>
              </div>
            </Card>
          ) : null}

          {deal ? (
            <DealLifecycleGuide
              deal={deal}
              role={participantRole}
              sellerSigned={sellerSigned}
              buyerSigned={buyerSigned}
              validSignatures={settlementQuery.data?.valid_signatures ?? 0}
              disputeResolved={Boolean(disputeDecision)}
            />
          ) : null}
          {session?.token && !hasSigningCapability && isParty ? <UnlockSigningKey pubkey={session.pubkey} /> : null}

          {agreement ? (
            <AgreementCard
              verification={agreementVerification}
              sellerSigned={sellerSigned}
              buyerSigned={buyerSigned}
              status={status}
              canSign={canSign}
              signing={signing}
              alreadySigned={alreadySigned}
              onSign={() => void onSignAgreement()}
            />
          ) : null}

          {deal?.escrow_address ? (
            <FundingCard
              escrowAddress={deal.escrow_address}
              funding={fundingQuery.data}
              fundingError={fundingQuery.isError ? errorMessage(fundingQuery.error, "Could not load funding instructions.") : null}
            />
          ) : null}

          {deal ? (
            <SettlementPanel
              deal={deal}
              settlement={settlementQuery.data ?? null}
              canPropose={canPropose}
              isParty={Boolean(isParty)}
              purpose={purpose}
              setPurpose={(next) => {
                setPurpose(next);
                setDestinationInput(null);
              }}
              destination={destination}
              setDestination={setDestinationInput}
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

          <DealEvidencePanel
            token={token}
            viewer={viewer}
            dealId={id}
            canSubmit={canParticipantAct("submit_evidence", status, participantRole)}
          />

          <Card tone="solid">
            <CardHeader title="Actions" description="Buttons explain why they are unavailable." />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ActionButton
                label="Prepare funding"
                icon={<Wallet className="size-3.5" />}
                reason={actionBlockedReason("prepare_funding", status, participantRole)}
                disabled={actionBusy || !canFund}
                onClick={() => withSession((t) => prepareFunding(t, id))}
              />
              <ActionButton
                label="Verify funding"
                icon={<CheckCircle2 className="size-3.5" />}
                reason={actionBlockedReason("verify_funding", status, participantRole)}
                disabled={actionBusy || deal?.status !== "awaiting_payment"}
                onClick={() => withSession((t) => verifyFunding(t, id))}
              />
              <ActionButton
                label="Mark shipped"
                icon={<Truck className="size-3.5" />}
                reason={actionBlockedReason("ship", status, participantRole)}
                disabled={actionBusy || !canParticipantAct("ship", status, participantRole)}
                onClick={() => withSession((t) => transitionDeal(t, id, "shipped" as DealStatus))}
              />
              <ActionButton
                label="Accept delivery"
                icon={<PackageCheck className="size-3.5" />}
                reason={actionBlockedReason("accept", status, participantRole)}
                disabled={actionBusy || !canParticipantAct("accept", status, participantRole)}
                onClick={() => withSession((t) => transitionDeal(t, id, "accepted" as DealStatus))}
              />
              <ActionButton
                label="Verify receipt"
                icon={<FileCheck2 className="size-3.5" />}
                onClick={() => void onExportReceipt()}
              />
            </div>
            {canOpenDispute ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/[0.05] p-4">
                <Input
                  label="Dispute reason"
                  value={disputeReason}
                  onChange={(event) => setDisputeReason(event.target.value)}
                />
                <div className="sm:max-w-56">
                  <ActionButton
                    label="Open dispute"
                    variant="danger"
                    icon={<Scale className="size-3.5" />}
                    reason={disputeBlocked}
                    disabled={actionBusy || !canOpenDispute || !disputeReason.trim()}
                    onClick={() => withSession((t) => openDispute(t, id, disputeReason.trim()))}
                  />
                </div>
              </div>
            ) : null}
          </Card>

          {receiptJson && receiptViewer === viewer ? (
            <ReceiptPanel dealId={id} receiptJson={receiptJson} verification={receiptVerification} />
          ) : null}
        </section>

        <aside className="min-w-0 animate-rise-delay">
          <DealTimeline token={token} viewer={viewer} dealId={id} />
        </aside>
      </div>
    </Shell>
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

/** Short, stable fingerprint of a PSBT for query keys (avoids keying on the whole base64). */
function psbtFingerprint(psbt: string | null | undefined): string {
  if (!psbt) return "none";
  return `${psbt.length}:${psbt.slice(-24)}`;
}
