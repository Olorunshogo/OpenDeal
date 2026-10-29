import { hex } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp from "@noble/secp256k1";

export interface CanonicalAgreement {
  version: number;
  title: string;
  description?: string;
  seller_payout_address?: string;
  buyer_refund_address?: string;
  amount_sats: number;
  currency: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  mediator_pubkey: string;
  delivery_deadline: string;
  acceptance_window_hours: number;
  settlement_model: string;
  network: string;
  created_at: string;
}

export interface DealAgreementExpectation {
  id: string;
  title: string;
  amount_sats: number;
  currency: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  mediator_pubkey: string;
  delivery_deadline: string;
  acceptance_window_hours: number;
  settlement_model: string;
  network: string;
}

export type AgreementVerification =
  | { valid: true; agreement: CanonicalAgreement; digest: string }
  | { valid: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHex(value: string): Uint8Array {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("Canonical agreement is not valid hexadecimal.");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeIdentity(value: string): string {
  const normalized = value.trim().toLowerCase();
  const xOnly = /^(02|03)[0-9a-f]{64}$/.test(normalized)
    ? normalized.slice(2)
    : /^[0-9a-f]{64}$/.test(normalized)
      ? normalized
      : null;
  if (!xOnly || !secp.utils.isValidPublicKey(hex.decode(`02${xOnly}`))) {
    throw new Error("Agreement contains an invalid participant public key.");
  }
  return xOnly;
}

function assertAgreement(
  value: unknown,
  requireSignedDestinations: boolean,
): asserts value is CanonicalAgreement {
  if (!isRecord(value)) {
    throw new Error("Canonical agreement must be a JSON object.");
  }
  const allowedFields = new Set([
    "version",
    "title",
    "description",
    "seller_payout_address",
    "buyer_refund_address",
    "amount_sats",
    "currency",
    "seller_pubkey",
    "buyer_pubkey",
    "mediator_pubkey",
    "delivery_deadline",
    "acceptance_window_hours",
    "settlement_model",
    "network",
    "created_at",
  ]);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new Error("Canonical agreement contains an unsupported term.");
  }
  const requiredStrings = [
    "title",
    "currency",
    "seller_pubkey",
    "buyer_pubkey",
    "mediator_pubkey",
    "delivery_deadline",
    "settlement_model",
    "network",
    "created_at",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new Error(`Agreement is missing required term: ${field}.`);
    }
  }
  for (const field of ["seller_payout_address", "buyer_refund_address"] as const) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" || !value[field].trim())
    ) {
      throw new Error(`Agreement contains an invalid term: ${field}.`);
    }
    if (requireSignedDestinations && typeof value[field] !== "string") {
      throw new Error(`Agreement is missing required term: ${field}.`);
    }
  }
  if (
    (value.description !== undefined && typeof value.description !== "string") ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.amount_sats) ||
    (value.amount_sats as number) <= 0 ||
    value.currency !== "BTC" ||
    !Number.isSafeInteger(value.acceptance_window_hours) ||
    (value.acceptance_window_hours as number) < 1 ||
    (value.acceptance_window_hours as number) > 8760
  ) {
    throw new Error("Canonical agreement contains invalid or unsupported terms.");
  }
  const participantIdentities = [
    normalizeIdentity(value.seller_pubkey as string),
    normalizeIdentity(value.buyer_pubkey as string),
    normalizeIdentity(value.mediator_pubkey as string),
  ];
  if (new Set(participantIdentities).size !== participantIdentities.length) {
    throw new Error("Agreement participant identities must be distinct.");
  }
  if (
    !Number.isFinite(Date.parse(value.delivery_deadline as string)) ||
    !Number.isFinite(Date.parse(value.created_at as string))
  ) {
    throw new Error("Agreement contains an invalid timestamp.");
  }
}

function assertDisplayMatchesCanonical(
  canonical: CanonicalAgreement,
  displayed: unknown,
): void {
  if (!isRecord(displayed)) {
    throw new Error("Agreement response is missing its display terms.");
  }
  const canonicalKeys = Object.keys(canonical).sort();
  const displayedKeys = Object.keys(displayed).sort();
  if (
    canonicalKeys.length !== displayedKeys.length ||
    canonicalKeys.some((key, index) => key !== displayedKeys[index]) ||
    canonicalKeys.some((key) => displayed[key] !== canonical[key as keyof CanonicalAgreement])
  ) {
    throw new Error("Displayed agreement terms do not match the canonical bytes.");
  }
}

export function serializeCanonicalAgreement(agreement: CanonicalAgreement): Uint8Array {
  const ordered: Record<string, unknown> = {
    version: agreement.version,
    title: agreement.title,
  };
  if (agreement.description !== undefined) {
    ordered.description = agreement.description;
  }
  if (agreement.seller_payout_address !== undefined) {
    ordered.seller_payout_address = agreement.seller_payout_address;
  }
  if (agreement.buyer_refund_address !== undefined) {
    ordered.buyer_refund_address = agreement.buyer_refund_address;
  }
  Object.assign(ordered, {
    amount_sats: agreement.amount_sats,
    currency: agreement.currency,
    seller_pubkey: agreement.seller_pubkey,
    buyer_pubkey: agreement.buyer_pubkey,
    mediator_pubkey: agreement.mediator_pubkey,
    delivery_deadline: agreement.delivery_deadline,
    acceptance_window_hours: agreement.acceptance_window_hours,
    settlement_model: agreement.settlement_model,
    network: agreement.network,
    created_at: agreement.created_at,
  });
  return new TextEncoder().encode(JSON.stringify(ordered));
}

export function verifyCanonicalAgreement(
  canonicalHex: string,
  displayedAgreement: unknown,
  deal: DealAgreementExpectation,
  requireSignedDestinations = true,
): AgreementVerification {
  try {
    const bytes = decodeHex(canonicalHex);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    assertAgreement(parsed, requireSignedDestinations);
    assertDisplayMatchesCanonical(parsed, displayedAgreement);
    const canonicalBytes = serializeCanonicalAgreement(parsed);
    if (canonicalBytes.length !== bytes.length || canonicalBytes.some((byte, index) => byte !== bytes[index])) {
      throw new Error("Agreement bytes are not in the backend's canonical field order.");
    }

    const digest = toHex(sha256(bytes));
    if (digest !== deal.id.toLowerCase()) {
      throw new Error("Canonical agreement hash does not match the deal ID.");
    }

    const comparisons: Array<[string, string | number, string | number]> = [
      ["title", parsed.title, deal.title],
      ["amount", parsed.amount_sats, deal.amount_sats],
      ["currency", parsed.currency, deal.currency],
      ["seller", normalizeIdentity(parsed.seller_pubkey), normalizeIdentity(deal.seller_pubkey)],
      ["buyer", normalizeIdentity(parsed.buyer_pubkey), normalizeIdentity(deal.buyer_pubkey)],
      [
        "mediator",
        normalizeIdentity(parsed.mediator_pubkey),
        normalizeIdentity(deal.mediator_pubkey),
      ],
      ["settlement model", parsed.settlement_model, deal.settlement_model],
      ["network", parsed.network, deal.network],
      ["acceptance window", parsed.acceptance_window_hours, deal.acceptance_window_hours],
    ];
    for (const [label, canonicalValue, dealValue] of comparisons) {
      if (canonicalValue !== dealValue) {
        throw new Error(`Canonical agreement ${label} does not match the loaded deal.`);
      }
    }
    if (Date.parse(parsed.delivery_deadline) !== Date.parse(deal.delivery_deadline)) {
      throw new Error("Canonical agreement delivery deadline does not match the loaded deal.");
    }

    return { valid: true, agreement: parsed, digest };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Could not verify canonical agreement.",
    };
  }
}
