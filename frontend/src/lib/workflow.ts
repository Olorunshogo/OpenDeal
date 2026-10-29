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
