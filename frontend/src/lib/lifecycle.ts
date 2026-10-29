import type { ParticipantRole } from "./workflow.ts";
export const DEAL_STEPS = [
  "Create deal",
  "Review agreement",
  "Seller signs",
  "Buyer signs",
  "Prepare escrow",
  "Fund escrow",
  "Confirm funding",
  "Mark delivery",
  "Accept delivery",
  "Propose settlement",
  "Review PSBT",
  "Collect signatures",
  "Broadcast settlement",
  "Confirm settlement",
  "Verify receipt",
];
export interface LifecycleState {
  status: string;
  escrow_address?: string | null;
  funding_txid?: string | null;
  current_psbt?: string | null;
  settlement_txid?: string | null;
  settlement_phase?: string;
}
export function nextDealStep(
  deal: LifecycleState,
  role: ParticipantRole,
  sellerSigned = false,
  buyerSigned = false,
  validSignatures = 0,
  disputeResolved = false
) {
  let title: string | undefined;
  let index = 1,
    actor = "buyer and seller",
    explanation = "Review the exact signed terms before authorizing anything.";
  switch (deal.status) {
    case "draft":
      index = !sellerSigned ? 2 : !buyerSigned ? 3 : 4;
      actor = !sellerSigned
        ? "seller"
        : !buyerSigned
          ? "buyer"
          : "a participant";
      explanation =
        "Both buyer and seller must explicitly sign the verified canonical agreement.";
      break;
    case "agreed":
      index = 4;
      actor = "a participant";
      explanation = "Prepare the 2-of-3 escrow address after both signatures.";
      break;
    case "awaiting_payment":
      index = deal.funding_txid ? 6 : 5;
      actor = "buyer";
      explanation =
        "Fund only the displayed escrow address using your external wallet, then verify the required confirmations. Payment is an explicit wallet action.";
      break;
    case "funded":
      index = 7;
      actor = "seller";
      explanation = "The seller marks delivery once the goods have been sent.";
      break;
    case "shipped":
      index = 8;
      actor = "buyer";
      explanation = "The buyer accepts delivery after checking the goods.";
      break;
    case "accepted":
      index = 9;
      actor = "a participant";
      explanation =
        "Propose payout only to the signed seller destination, with an explicit fee.";
      break;
    case "disputed":
      index = 9;
      title = disputeResolved ? undefined : "Review and resolve dispute";
      actor = disputeResolved ? "a participant" : "assigned approved mediator";
      explanation =
        "Review the dispute and evidence at the dispute desk. A decision authorizes a purpose; it never transfers Bitcoin. Then propose the authorized payout or refund.";
      break;
    case "settled":
    case "refunded":
      index = 14;
      actor = "a participant";
      explanation =
        "Verify and export the receipt. Independently check active-chain confirmation with your node.";
      break;
    case "cancelled":
    case "expired":
      return {
        index: 0,
        title: "Deal closed",
        actor: "none",
        explanation:
          "This deal is closed. Create a new agreement rather than replacing its participants.",
        yourRole: role,
      };
  }
  if (!["settled", "refunded"].includes(deal.status)) {
    if (deal.current_psbt) {
      title = undefined;
      index = validSignatures >= 2 ? 12 : validSignatures === 1 ? 11 : 10;
      actor =
        validSignatures >= 2 ? "a participant" : "two escrow participants";
      explanation =
        "Review the validated input, destination, output and fee, then explicitly add each participant's signature. Broadcast becomes available after two valid signatures.";
    }
    if (deal.settlement_txid) {
      title = undefined;
      index = 13;
      actor = "a participant";
      explanation =
        "A broadcast intent is not confirmation. Check the recorded transaction against Core and wait for the required confirmations; inspect uncertain results before any retry.";
    }
  }
  return { index, title, actor, explanation, yourRole: role };
}
