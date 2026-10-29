import * as secp from "@noble/secp256k1";
import { hex } from "@scure/base";
import { sortedMultisig } from "@scure/btc-signer/payment.js";
import { validateBitcoinAddressForNetwork } from "./bitcoin-address.ts";
import { networkParams } from "./psbt.ts";

// Prepared-deal configuration exported by `opendeal-tui` (docs/tui.md).
// Public data only. Every field is checked here, and the API checks it again on create.

export const PREPARED_DEAL_SCHEMA_VERSION = 1;
export const PREPARED_DEAL_KIND = "opendeal.prepared_deal";
export const MAX_PREPARED_DEAL_BYTES = 16 * 1024;
const SETTLEMENT_MODEL = "bitcoin_multisig_2of3";
const SCRIPT_TYPE = "p2wsh_multisig_2of3_sorted";
// Mirrors opendeal-bitcoin FeeDustPolicy and the API's create_deal limits.
const MIN_AMOUNT_SATS = 10_000;
const MAX_AMOUNT_SATS = 2_100_000_000_000_000;
const MAX_TITLE_BYTES = 256;
const MAX_DESCRIPTION_BYTES = 10_000;
const MAX_ACCEPTANCE_HOURS = 8_760;

export interface PreparedDeal {
  schema_version: 1;
  kind: typeof PREPARED_DEAL_KIND;
  generated_at: string;
  generator: string;
  network: string;
  settlement_model: typeof SETTLEMENT_MODEL;
  deal: {
    title: string;
    description?: string;
    amount_sats: number;
    currency: "BTC";
    delivery_deadline: string;
    acceptance_window_hours: number;
    seller_payout_address: string;
    buyer_refund_address: string;
  };
  participants: {
    seller_pubkey: string;
    buyer_pubkey: string;
    mediator_pubkey: string;
    mediator_display_name?: string;
  };
  escrow_preview: {
    address: string;
    script_type: typeof SCRIPT_TYPE;
    witness_script_hex: string;
    script_pubkey_hex: string;
    sorted_pubkeys: string[];
  };
}

export interface ImportContext {
  network: string;
  pilotMaxAmountSats: number | null;
  now?: Date;
}

export type ParseResult =
  | { ok: true; value: PreparedDeal }
  | { ok: false; errors: string[] };

type Json = Record<string, unknown>;
const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).length;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: unknown,
  path: string,
  required: string[],
  optional: string[],
  errors: string[],
): value is Json {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      errors.push(`Unexpected field ${path}.${key}; only documented public fields are accepted.`);
    }
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`Missing ${path}.${key}.`);
  }
  return true;
}

function isPublicIdentity(value: unknown): value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return false;
  try {
    return secp.utils.isValidPublicKey(hex.decode(`02${value}`));
  } catch {
    return false;
  }
}

/** Re-derives the 2-of-3 P2WSH escrow the same way the API does (keys as 02||x, sorted). */
export function deriveEscrowPreview(
  pubkeys: [string, string, string],
  network: string,
): { address: string; witness_script_hex: string; script_pubkey_hex: string; sorted_pubkeys: string[] } {
  const compressed = pubkeys.map((key) => hex.decode(`02${key}`));
  const payment = sortedMultisig(2, compressed, true, networkParams(network));
  if (!payment.address || !payment.witnessScript) {
    throw new Error("Escrow script could not be derived.");
  }
  return {
    address: payment.address,
    witness_script_hex: hex.encode(payment.witnessScript),
    script_pubkey_hex: hex.encode(payment.script),
    sorted_pubkeys: pubkeys.map((key) => `02${key}`).sort(),
  };
}

export function parsePreparedDeal(text: string, context: ImportContext): ParseResult {
  const errors: string[] = [];
  if (byteLength(text) > MAX_PREPARED_DEAL_BYTES) {
    return { ok: false, errors: ["Configuration file is too large."] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["File is not valid JSON."] };
  }
  if (!isObject(raw)) {
    return { ok: false, errors: ["Configuration must be a JSON object."] };
  }
  if (raw.schema_version !== PREPARED_DEAL_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        typeof raw.schema_version === "number"
          ? `Unsupported schema_version ${raw.schema_version}; this app supports ${PREPARED_DEAL_SCHEMA_VERSION}.`
          : "Missing schema_version; this is not an OpenDeal prepared configuration.",
      ],
    };
  }
  const top = [
    "schema_version",
    "kind",
    "generated_at",
    "generator",
    "network",
    "settlement_model",
    "deal",
    "participants",
    "escrow_preview",
  ];
  checkKeys(raw, "config", top, [], errors);
  if (raw.kind !== PREPARED_DEAL_KIND) errors.push(`kind must be "${PREPARED_DEAL_KIND}".`);
  if (typeof raw.generated_at !== "string" || !Number.isFinite(Date.parse(raw.generated_at)))
    errors.push("generated_at must be a timestamp.");
  if (typeof raw.generator !== "string" || raw.generator.length > 100)
    errors.push("generator must be a short string.");
  const network = typeof raw.network === "string" ? raw.network : "";
  if (network !== context.network) {
    errors.push(
      `Configuration is for ${network || "an unknown network"} but this server uses ${context.network}.`,
    );
  }
  if (network === "bitcoin" || network === "mainnet") {
    errors.push("Prepared configurations are only accepted on test networks.");
  }
  if (raw.settlement_model !== SETTLEMENT_MODEL) {
    errors.push("Only bitcoin_multisig_2of3 deals can be imported.");
  }

  const now = (context.now ?? new Date()).getTime();
  const deal = raw.deal;
  if (
    checkKeys(
      deal,
      "deal",
      [
        "title",
        "amount_sats",
        "currency",
        "delivery_deadline",
        "acceptance_window_hours",
        "seller_payout_address",
        "buyer_refund_address",
      ],
      ["description"],
      errors,
    )
  ) {
    const title = deal.title;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title !== title.trim() ||
      byteLength(title) > MAX_TITLE_BYTES
    )
      errors.push("deal.title must be 1–256 bytes without surrounding spaces.");
    if (
      deal.description !== undefined &&
      (typeof deal.description !== "string" || byteLength(deal.description) > MAX_DESCRIPTION_BYTES)
    )
      errors.push("deal.description must be at most 10,000 bytes.");
    const amount = deal.amount_sats;
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < MIN_AMOUNT_SATS ||
      amount > MAX_AMOUNT_SATS
    ) {
      errors.push(`deal.amount_sats must be a whole number of at least ${MIN_AMOUNT_SATS} sats.`);
    } else if (context.pilotMaxAmountSats !== null && amount > context.pilotMaxAmountSats) {
      errors.push(`deal.amount_sats exceeds the server cap of ${context.pilotMaxAmountSats} sats.`);
    }
    if (deal.currency !== "BTC") errors.push("deal.currency must be BTC.");
    const deadline =
      typeof deal.delivery_deadline === "string" ? Date.parse(deal.delivery_deadline) : NaN;
    if (!Number.isFinite(deadline)) errors.push("deal.delivery_deadline must be a timestamp.");
    else if (deadline <= now)
      errors.push("deal.delivery_deadline has passed; prepare the deal again in the TUI.");
    const hours = deal.acceptance_window_hours;
    if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > MAX_ACCEPTANCE_HOURS)
      errors.push("deal.acceptance_window_hours must be 1–8760.");
    for (const field of ["seller_payout_address", "buyer_refund_address"] as const) {
      const address = deal[field];
      try {
        if (typeof address !== "string" || address !== address.trim()) throw new Error();
        validateBitcoinAddressForNetwork(address, context.network);
      } catch {
        errors.push(`deal.${field} is not a valid ${context.network} address.`);
      }
    }
  }

  const participants = raw.participants;
  let keys: [string, string, string] | null = null;
  if (
    checkKeys(
      participants,
      "participants",
      ["seller_pubkey", "buyer_pubkey", "mediator_pubkey"],
      ["mediator_display_name"],
      errors,
    )
  ) {
    const roles = ["seller_pubkey", "buyer_pubkey", "mediator_pubkey"] as const;
    const valid = roles.every((role) => {
      if (isPublicIdentity(participants[role])) return true;
      errors.push(`participants.${role} must be a lowercase 64-character x-only public key.`);
      return false;
    });
    if (valid) {
      keys = roles.map((role) => participants[role] as string) as [string, string, string];
      if (new Set(keys).size !== 3) {
        errors.push("Seller, buyer and mediator must be three distinct identities.");
        keys = null;
      }
    }
    const name = participants.mediator_display_name;
    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim() || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    )
      errors.push("participants.mediator_display_name is malformed.");
  }

  const escrow = raw.escrow_preview;
  if (
    checkKeys(
      escrow,
      "escrow_preview",
      ["address", "script_type", "witness_script_hex", "script_pubkey_hex", "sorted_pubkeys"],
      [],
      errors,
    ) &&
    keys &&
    errors.length === 0
  ) {
    try {
      const expected = deriveEscrowPreview(keys, context.network);
      const sorted = escrow.sorted_pubkeys;
      if (
        escrow.script_type !== SCRIPT_TYPE ||
        escrow.address !== expected.address ||
        escrow.witness_script_hex !== expected.witness_script_hex ||
        escrow.script_pubkey_hex !== expected.script_pubkey_hex ||
        !Array.isArray(sorted) ||
        sorted.join(",") !== expected.sorted_pubkeys.join(",")
      ) {
        errors.push("escrow_preview does not match the participants' 2-of-3 escrow script.");
      }
    } catch {
      errors.push("escrow_preview could not be re-derived.");
    }
  }

  if (errors.length > 0 || !keys || !isObject(deal) || !isObject(escrow) || !isObject(participants)) {
    return { ok: false, errors: errors.length ? errors : ["Invalid configuration."] };
  }
  // Rebuild from whitelisted fields only.
  return {
    ok: true,
    value: {
      schema_version: 1,
      kind: PREPARED_DEAL_KIND,
      generated_at: raw.generated_at as string,
      generator: raw.generator as string,
      network,
      settlement_model: SETTLEMENT_MODEL,
      deal: {
        title: deal.title as string,
        ...(typeof deal.description === "string" && deal.description.trim()
          ? { description: deal.description }
          : {}),
        amount_sats: deal.amount_sats as number,
        currency: "BTC",
        delivery_deadline: new Date(Date.parse(deal.delivery_deadline as string)).toISOString(),
        acceptance_window_hours: deal.acceptance_window_hours as number,
        seller_payout_address: deal.seller_payout_address as string,
        buyer_refund_address: deal.buyer_refund_address as string,
      },
      participants: {
        seller_pubkey: keys[0],
        buyer_pubkey: keys[1],
        mediator_pubkey: keys[2],
        ...(typeof participants.mediator_display_name === "string"
          ? { mediator_display_name: participants.mediator_display_name }
          : {}),
      },
      escrow_preview: {
        address: escrow.address as string,
        script_type: SCRIPT_TYPE,
        witness_script_hex: escrow.witness_script_hex as string,
        script_pubkey_hex: escrow.script_pubkey_hex as string,
        sorted_pubkeys: [...(escrow.sorted_pubkeys as string[])],
      },
    },
  };
}

export interface ImportCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Checks against the live session and registry, shown in the preview before applying. */
export function preparedDealChecks(
  deal: PreparedDeal,
  options: {
    sessionPubkey?: string | null;
    approvedMediators?: { pubkey: string; display_name: string }[];
  },
): { checks: ImportCheck[]; canApply: boolean } {
  const session = (options.sessionPubkey ?? "").trim().toLowerCase();
  const sessionX = /^(02|03)[0-9a-f]{64}$/.test(session) ? session.slice(2) : session;
  const sellerOk = sessionX === deal.participants.seller_pubkey;
  const mediator = options.approvedMediators?.find(
    (m) => m.pubkey === deal.participants.mediator_pubkey,
  );
  const checks: ImportCheck[] = [
    {
      label: "Escrow preview re-derived in the browser",
      ok: true,
      detail: `${deal.escrow_preview.address} (preview only; not funded)`,
    },
    {
      label: "Seller is the signed-in identity",
      ok: sellerOk,
      detail: sellerOk
        ? "The API will create the deal as this seller."
        : "Sign in as the prepared seller first (Sign in page). The API rejects a different seller.",
    },
    {
      label: "Mediator is approved in the registry",
      ok: Boolean(mediator),
      detail: mediator
        ? mediator.display_name
        : "Not in the approved mediator list. Register/approve it, then import again.",
    },
  ];
  return { checks, canApply: Boolean(mediator) };
}

export interface DealFormValues {
  title: string;
  description: string;
  amountSats: string;
  buyerPubkey: string;
  mediatorPubkey: string;
  sellerPayoutAddress: string;
  buyerRefundAddress: string;
  /** ISO timestamp; null means "three days from submission" (the manual default). */
  deliveryDeadline: string | null;
  acceptanceWindowHours: number;
}

export interface ImportedConstraints {
  seller_pubkey: string;
  network: string;
  settlement_model: string;
}

export function formValuesFromPreparedDeal(deal: PreparedDeal): {
  values: DealFormValues;
  constraints: ImportedConstraints;
} {
  return {
    values: {
      title: deal.deal.title,
      description: deal.deal.description ?? "",
      amountSats: String(deal.deal.amount_sats),
      buyerPubkey: deal.participants.buyer_pubkey,
      mediatorPubkey: deal.participants.mediator_pubkey,
      sellerPayoutAddress: deal.deal.seller_payout_address,
      buyerRefundAddress: deal.deal.buyer_refund_address,
      deliveryDeadline: deal.deal.delivery_deadline,
      acceptanceWindowHours: deal.deal.acceptance_window_hours,
    },
    constraints: {
      seller_pubkey: deal.participants.seller_pubkey,
      network: deal.network,
      settlement_model: deal.settlement_model,
    },
  };
}

export interface CreateDealInput {
  title: string;
  description?: string;
  amount_sats: number;
  buyer_pubkey: string;
  mediator_pubkey: string;
  delivery_deadline: string;
  acceptance_window_hours: number;
  seller_payout_address: string;
  buyer_refund_address: string;
  seller_pubkey?: string;
  network?: string;
  settlement_model?: string;
}

/**
 * Builds the POST /api/v1/deals body. Imported deals also send seller, network and settlement
 * model so the API rejects them if they differ from the session or server configuration.
 */
export function buildCreateDealInput(
  form: DealFormValues,
  imported: ImportedConstraints | null,
  now: Date = new Date(),
): CreateDealInput {
  const input: CreateDealInput = {
    title: form.title,
    amount_sats: Number(form.amountSats),
    buyer_pubkey: form.buyerPubkey.trim(),
    mediator_pubkey: form.mediatorPubkey.trim(),
    delivery_deadline:
      form.deliveryDeadline ?? new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    acceptance_window_hours: form.acceptanceWindowHours,
    seller_payout_address: form.sellerPayoutAddress.trim(),
    buyer_refund_address: form.buyerRefundAddress.trim(),
  };
  if (form.description.trim()) input.description = form.description.trim();
  if (imported) {
    input.seller_pubkey = imported.seller_pubkey;
    input.network = imported.network;
    input.settlement_model = imported.settlement_model;
  }
  return input;
}
