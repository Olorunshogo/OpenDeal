import { hex } from "@scure/base";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp from "@noble/secp256k1";
import {
  serializeCanonicalAgreement,
  verifyCanonicalAgreement,
  type CanonicalAgreement,
} from "./agreement-verification.ts";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, message: Uint8Array) => hmac(sha256, key, message);

export interface ReceiptSignature {
  sig: string;
  pubkey: string;
}

export interface ReceiptEvent {
  agreement_id: string;
  sequence: number;
  kind: string;
  payload: unknown;
  actor_pubkey: string;
  prev_event_hash: string;
  created_at: string;
  signature: ReceiptSignature | null;
}

export interface VerifiableDealReceipt {
  agreement: CanonicalAgreement;
  agreement_id: string;
  status: string;
  settlement_model: string;
  network: string;
  agreement_signatures: ReceiptSignature[];
  events: ReceiptEvent[];
  funding_txid: string | null;
  settlement_txid: string | null;
}

export type ReceiptVerification =
  | { valid: true; checks: string[]; limitations: string[] }
  | { valid: false; error: string };

const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["agreed", "cancelled"],
  agreed: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["funded", "expired", "cancelled"],
  funded: ["shipped", "disputed", "cancelled"],
  shipped: ["accepted", "disputed"],
  accepted: ["settled", "disputed"],
  disputed: ["settled", "refunded"],
  settled: [],
  cancelled: [],
  refunded: [],
  expired: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedIdentity(value: string): string {
  const clean = value.trim().toLowerCase();
  if (/^(02|03)[0-9a-f]{64}$/.test(clean)) {
    return clean.slice(2);
  }
  if (/^[0-9a-f]{64}$/.test(clean)) {
    return clean;
  }
  throw new Error("Receipt contains an invalid participant public key.");
}

function verifySignature(messageBytes: Uint8Array, signature: ReceiptSignature): boolean {
  try {
    const sig = hex.decode(signature.sig);
    const pubkey = hex.decode(signature.pubkey);
    return (
      sig.length === 64 &&
      pubkey.length === 33 &&
      secp.verify(sig, sha256(messageBytes), pubkey, { prehash: false })
    );
  } catch {
    return false;
  }
}

function verifyEventChain(events: ReceiptEvent[], agreementId: string): string | null {
  let previousHash = "";
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      !event ||
      event.agreement_id !== agreementId ||
      event.sequence !== index ||
      event.prev_event_hash !== previousHash ||
      !Number.isSafeInteger(event.sequence) ||
      !isRecord(event.payload) ||
      event.payload.type !== event.kind
    ) {
      return `Event chain mismatch at sequence ${index}.`;
    }
    const signable = {
      agreement_id: event.agreement_id,
      sequence: event.sequence,
      kind: event.kind,
      payload: event.payload,
      actor_pubkey: event.actor_pubkey,
      prev_event_hash: event.prev_event_hash,
      created_at: event.created_at,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(signable));
    if (event.signature) {
      if (
        !verifySignature(bytes, event.signature) ||
        normalizedIdentity(event.signature.pubkey) !== normalizedIdentity(event.actor_pubkey)
      ) {
        return `Event signature is invalid at sequence ${index}.`;
      }
    }
    previousHash = bytesHex(sha256(bytes));
  }
  return null;
}

export function verifyDealReceipt(value: unknown): ReceiptVerification {
  try {
    if (!isRecord(value) || !isRecord(value.agreement)) {
      throw new Error("Receipt is missing its agreement.");
    }
    const receipt = value as unknown as VerifiableDealReceipt;
    if (
      typeof receipt.agreement_id !== "string" ||
      typeof receipt.status !== "string" ||
      !Array.isArray(receipt.agreement_signatures) ||
      !Array.isArray(receipt.events)
    ) {
      throw new Error("Receipt is missing required fields.");
    }
    const agreement = receipt.agreement;
    const canonicalBytes = serializeCanonicalAgreement(agreement);
    const canonicalHex = hex.encode(canonicalBytes);
    const agreementVerification = verifyCanonicalAgreement(
      canonicalHex,
      agreement,
      {
        id: receipt.agreement_id,
        title: agreement.title,
        amount_sats: agreement.amount_sats,
        currency: agreement.currency,
        seller_pubkey: agreement.seller_pubkey,
        buyer_pubkey: agreement.buyer_pubkey,
        mediator_pubkey: agreement.mediator_pubkey,
        delivery_deadline: agreement.delivery_deadline,
        acceptance_window_hours: agreement.acceptance_window_hours,
        settlement_model: agreement.settlement_model,
        network: agreement.network,
      },
      false,
    );
    if (!agreementVerification.valid) {
      throw new Error(agreementVerification.error);
    }
    if (
      receipt.settlement_model !== agreement.settlement_model ||
      receipt.network !== agreement.network ||
      !ALLOWED_NEXT[receipt.status]
    ) {
      throw new Error("Receipt model, network, or status does not match the agreement contract.");
    }

    const parties = new Set([
      normalizedIdentity(agreement.buyer_pubkey),
      normalizedIdentity(agreement.seller_pubkey),
    ]);
    for (const signature of receipt.agreement_signatures) {
      if (
        !verifySignature(canonicalBytes, signature) ||
        !parties.has(normalizedIdentity(signature.pubkey))
      ) {
        throw new Error("Receipt contains an invalid or unauthorized agreement signature.");
      }
    }
    if (!(["draft", "cancelled"].includes(receipt.status))) {
      for (const party of parties) {
        if (
          !receipt.agreement_signatures.some(
            (signature) => normalizedIdentity(signature.pubkey) === party,
          )
        ) {
          throw new Error("Receipt is missing a buyer or seller agreement signature.");
        }
      }
    }

    const eventError = verifyEventChain(receipt.events, receipt.agreement_id);
    if (eventError) {
      throw new Error(eventError);
    }
    let status = "draft";
    let funding: string | null = null;
    let settlement: string | null = null;
    let confirmed: string | null = null;
    let reorg = false;
    for (const event of receipt.events) {
      const payload = event.payload as Record<string, unknown>;
      if (payload.type === "status_transitioned") {
        const from = payload.from;
        const to = payload.to;
        const allowed = typeof from === "string" && ALLOWED_NEXT[from]?.includes(String(to));
        const allowedAfterReorg =
          reorg &&
          ["settled", "refunded"].includes(String(from)) &&
          ["accepted", "disputed"].includes(String(to));
        if (from !== status || (!allowed && !allowedAfterReorg)) {
          throw new Error("Receipt contains an invalid lifecycle transition.");
        }
        status = String(to);
        reorg = false;
      } else if (payload.type === "funding_detected") {
        funding = String(payload.txid);
      } else if (
        payload.type === "settlement_broadcast_requested" ||
        payload.type === "settlement_broadcast"
      ) {
        settlement = String(payload.txid);
      } else if (payload.type === "settlement_confirmed" && Number(payload.confirmations) > 0) {
        if (settlement !== payload.txid) {
          throw new Error("Receipt confirmation does not match the settlement transaction.");
        }
        confirmed = String(payload.txid);
      } else if (payload.type === "settlement_reorged") {
        if (settlement !== payload.txid) {
          throw new Error("Receipt reorg does not match the settlement transaction.");
        }
        confirmed = null;
        reorg = true;
      }
    }
    if (
      status !== receipt.status ||
      funding !== receipt.funding_txid ||
      settlement !== receipt.settlement_txid
    ) {
      throw new Error("Receipt status or transaction IDs disagree with its event history.");
    }
    if (
      ["settled", "refunded"].includes(receipt.status) &&
      (!confirmed || confirmed !== receipt.settlement_txid)
    ) {
      throw new Error("Terminal receipt status lacks a matching confirmation event.");
    }

    return {
      valid: true,
      checks: [
        "Canonical agreement hash matches the receipt ID.",
        "Agreement signatures and participant identities are valid.",
        "Event hashes, ordering, and optional event signatures are consistent.",
        "Lifecycle, funding, settlement, and confirmation records agree.",
      ],
      limitations: [
        "Event history is server-provided and not externally anchored; a malicious server can rewrite the complete receipt.",
        "A confirmation event is not independent proof that the transaction remains in the active Bitcoin chain. Verify it against your own node.",
      ],
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Receipt verification failed.",
    };
  }
}
