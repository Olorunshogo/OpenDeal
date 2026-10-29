export type ParticipantRole = "buyer" | "seller" | "mediator" | "other";
export type DealAction = "sign" | "submit_evidence" | "open_dispute" | "ship" | "accept";

export function participantRoleForAgreement(
  pubkey: string | null | undefined,
  agreement: { buyer_pubkey: string; seller_pubkey: string; mediator_pubkey: string } | null | undefined,
): ParticipantRole {
  if (!pubkey || !agreement) return "other";
  const normalize = (key: string) => key.trim().toLowerCase().replace(/^(02|03)(?=[0-9a-f]{64}$)/, "");
  const identity = normalize(pubkey);
  if (!/^[0-9a-f]{64}$/.test(identity)) return "other";
  if (identity === normalize(agreement.buyer_pubkey)) return "buyer";
  if (identity === normalize(agreement.seller_pubkey)) return "seller";
  if (identity === normalize(agreement.mediator_pubkey)) return "mediator";
  return "other";
}

export function canParticipantAct(
  action: DealAction,
  status: string,
  role: ParticipantRole,
  settlementLocked = false,
): boolean {
  switch (action) {
    case "sign":
      return status === "draft" && (role === "buyer" || role === "seller");
    case "submit_evidence":
      return role === "buyer" || role === "seller";
    case "open_dispute":
      return (
        (role === "buyer" || role === "seller") &&
        ["funded", "shipped", "accepted"].includes(status) &&
        !settlementLocked
      );
    case "ship":
      return status === "funded" && role === "seller";
    case "accept":
      return status === "shipped" && role === "buyer";
  }
}

export function canMediatorResolve(
  mediatorListAuthorized: boolean,
  disputeStatus: string | undefined,
  hasDetail: boolean,
  rationale: string,
): boolean {
  return (
    mediatorListAuthorized &&
    disputeStatus === "open" &&
    hasDetail &&
    Boolean(rationale.trim())
  );
}

export type BlockableAction = "prepare_funding" | "verify_funding" | "ship" | "accept" | "open_dispute";

const STATUS_ORDER = ["draft", "agreed", "awaiting_payment", "funded", "shipped", "accepted", "settled"];

function reached(status: string, target: string): boolean {
  const at = STATUS_ORDER.indexOf(status);
  return at >= 0 && at >= STATUS_ORDER.indexOf(target);
}

/**
 * Plain-language reason why an action button is unavailable, or null when it is available.
 * Shown under the buttons so the reason is visible without hovering (and on phones).
 */
export function actionBlockedReason(
  action: BlockableAction,
  status: string,
  role: ParticipantRole,
  settlementLocked = false,
): string | null {
  if (role === "other") return "You are not a participant in this deal.";
  const closed = ["settled", "cancelled", "refunded", "expired"].includes(status);
  switch (action) {
    case "prepare_funding":
      if (status === "agreed" || status === "awaiting_payment") return null;
      if (status === "draft") return "Both buyer and seller must sign the agreement first.";
      return closed ? "This deal is closed." : "The escrow is already funded.";
    case "verify_funding":
      if (status === "awaiting_payment") return null;
      if (status === "draft" || status === "agreed") return "Prepare funding and send the coins first.";
      return closed ? "This deal is closed." : "Funding is already verified.";
    case "ship":
      if (canParticipantAct("ship", status, role)) return null;
      if (role !== "seller") return "Only the seller marks the item shipped.";
      if (status === "disputed") return "The deal is in dispute.";
      if (!reached(status, "funded")) return "Waiting for the escrow to be funded.";
      return closed ? "This deal is closed." : "Already marked shipped.";
    case "accept":
      if (canParticipantAct("accept", status, role)) return null;
      if (role !== "buyer") return "Only the buyer accepts delivery.";
      if (status === "disputed") return "The deal is in dispute.";
      if (!reached(status, "shipped")) return "Waiting for the seller to ship.";
      return closed ? "This deal is closed." : "Delivery already accepted.";
    case "open_dispute":
      if (canParticipantAct("open_dispute", status, role, settlementLocked)) return null;
      if (role === "mediator") return "Only the buyer or seller can open a dispute.";
      if (settlementLocked) return "A settlement is already proposed or broadcast.";
      if (status === "disputed") return "A dispute is already open.";
      return "Disputes can be opened while funded, shipped, or accepted.";
  }
}
