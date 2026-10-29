import { base64, hex } from "@scure/base";
import { Address, OutScript, sortedMultisig } from "@scure/btc-signer/payment.js";
import { Transaction } from "@scure/btc-signer";
import type { BTC_NETWORK } from "@scure/btc-signer/utils.js";
import * as secp from "@noble/secp256k1";
import { secp256k1 } from "@noble/curves/secp256k1.js";

export type BitcoinNetworkName = string;

export interface PsbtInputSummary {
  txid: string;
  vout: number;
  amount_sats: number | null;
  partial_sigs: number;
}

export interface PsbtOutputSummary {
  address: string | null;
  amount_sats: number;
  script_hex: string;
}

export interface PsbtReviewSummary {
  unsigned_txid: string;
  fee_sats: number;
  inputs: PsbtInputSummary[];
  outputs: PsbtOutputSummary[];
  partial_sigs_total: number;
  partial_sig_pubkeys: string[];
  is_final: boolean;
}

export interface SettlementPsbtPolicy {
  network: BitcoinNetworkName;
  expected_unsigned_txid: string;
  funding_txid: string;
  funding_vout: number;
  funding_amount_sats: number;
  script_pubkey_hex: string;
  witness_script_hex: string;
  destination_address: string;
  participant_pubkeys: string[];
  min_fee_sats: number;
  max_fee_sats: number;
  max_fee_bps: number;
}

export interface NormalizedEscrowSigner {
  secret: Uint8Array;
  pubkey: Uint8Array;
}

const MAINNET: BTC_NETWORK = { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
const TESTNET: BTC_NETWORK = { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const REGTEST: BTC_NETWORK = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const SIGNET: BTC_NETWORK = { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const SIGHASH_ALL = 1;
const SETTLEMENT_SEQUENCE = 0xfffffffd;

export function networkParams(network: BitcoinNetworkName): BTC_NETWORK {
  switch (network.trim().toLowerCase()) {
    case "bitcoin":
    case "mainnet":
      return MAINNET;
    case "testnet":
    case "testnet3":
      return TESTNET;
    case "signet":
      return SIGNET;
    case "regtest":
      return REGTEST;
    default:
      throw new Error(`Unsupported Bitcoin network: ${network || "(empty)"}.`);
  }
}

function hexToBytes(value: string, label: string): Uint8Array {
  const clean = value.trim().toLowerCase().replace(/^0x/, "");
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error(`${label} must be hexadecimal bytes.`);
  }
  return hex.decode(clean);
}

function secretBytes(secretHex: string): Uint8Array {
  const secret = hexToBytes(secretHex, "Signing secret");
  if (secret.length !== 32 || !secp.utils.isValidSecretKey(secret)) {
    throw new Error("Signing secret must be a valid 32-byte secp256k1 scalar.");
  }
  return secret;
}

function normalizeXOnly(pubkey: string): string {
  const clean = pubkey.trim().toLowerCase().replace(/^0x/, "");
  if (/^(02|03)[0-9a-f]{64}$/.test(clean)) {
    return clean.slice(2);
  }
  if (/^[0-9a-f]{64}$/.test(clean)) {
    return clean;
  }
  throw new Error("Participant public key must be 32-byte x-only or compressed hex.");
}

function evenCompressedPubkey(xOnly: string): Uint8Array {
  return hex.decode(`02${normalizeXOnly(xOnly)}`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function allowedObjectKeys(value: object, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`${label} contains unsupported metadata: ${unknown.join(", ")}.`);
  }
}

function normalizeSigner(secretHex: string, expectedPubkey: string): NormalizedEscrowSigner {
  const secret = secretBytes(secretHex);
  const publicKey = secp.getPublicKey(secret, true);
  const expectedX = normalizeXOnly(expectedPubkey);
  if (hex.encode(publicKey.slice(1)) !== expectedX) {
    throw new Error("Signing secret does not match the authenticated participant identity.");
  }

  if (publicKey[0] === 2) {
    return { secret, pubkey: publicKey };
  }
  if (publicKey[0] !== 3) {
    throw new Error("Could not determine secp256k1 public-key parity.");
  }

  const curveOrder = secp.Point.CURVE().n;
  const scalar = BigInt(`0x${hex.encode(secret)}`);
  const normalizedScalar = curveOrder - scalar;
  const normalizedHex = normalizedScalar.toString(16).padStart(64, "0");
  const normalizedSecret = hex.decode(normalizedHex);
  const normalizedPubkey = secp.getPublicKey(normalizedSecret, true);
  if (normalizedPubkey[0] !== 2 || hex.encode(normalizedPubkey.slice(1)) !== expectedX) {
    throw new Error("Could not normalize the escrow signing key to its even-Y script key.");
  }
  return { secret: normalizedSecret, pubkey: normalizedPubkey };
}

function escrowDescriptor(policy: SettlementPsbtPolicy, network: BTC_NETWORK) {
  if (policy.participant_pubkeys.length !== 3) {
    throw new Error("Settlement verification requires exactly three escrow participants.");
  }
  const participants = policy.participant_pubkeys.map(evenCompressedPubkey);
  const participantHex = participants.map(hex.encode);
  if (new Set(participantHex).size !== 3) {
    throw new Error("Escrow participant keys must be distinct.");
  }
  const descriptor = sortedMultisig(2, participants, true, network);
  if (
    !descriptor.witnessScript ||
    !descriptor.address ||
    hex.encode(descriptor.witnessScript) !== policy.witness_script_hex.toLowerCase() ||
    hex.encode(descriptor.script) !== policy.script_pubkey_hex.toLowerCase()
  ) {
    throw new Error("Funding scripts do not match the agreement's 2-of-3 participant keys.");
  }
  return { participants: new Set(participantHex), descriptor };
}

export function validateSettlementPsbt(
  psbtBase64: string,
  policy: SettlementPsbtPolicy,
  signerPubkey?: string,
): PsbtReviewSummary {
  const network = networkParams(policy.network);
  const expectedAmount = BigInt(policy.funding_amount_sats);
  if (
    !Number.isSafeInteger(policy.funding_amount_sats) ||
    policy.funding_amount_sats <= 0 ||
    !Number.isSafeInteger(policy.funding_vout) ||
    policy.funding_vout < 0 ||
    !Number.isSafeInteger(policy.min_fee_sats) ||
    !Number.isSafeInteger(policy.max_fee_sats) ||
    !Number.isSafeInteger(policy.max_fee_bps) ||
    policy.min_fee_sats < 1 ||
    policy.max_fee_sats < policy.min_fee_sats ||
    policy.max_fee_bps < 1 ||
    policy.max_fee_bps > 10_000
  ) {
    throw new Error("Settlement verification policy is incomplete or invalid.");
  }
  if (!/^[0-9a-f]{64}$/i.test(policy.funding_txid)) {
    throw new Error("Expected funding transaction ID is invalid.");
  }
  const { participants } = escrowDescriptor(policy, network);
  const destination = OutScript.encode(Address(network).decode(policy.destination_address));
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64.trim()), {
    unknown: "strict",
    proprietary: "strict",
  });
  if (tx.inputsLength !== 1 || tx.outputsLength !== 1) {
    throw new Error("Settlement PSBT must have exactly one escrow input and one payout output.");
  }
  if (
    !/^[0-9a-f]{64}$/i.test(policy.expected_unsigned_txid) ||
    tx.id.toLowerCase() !== policy.expected_unsigned_txid.toLowerCase()
  ) {
    throw new Error("PSBT does not match the backend's immutable settlement proposal.");
  }
  if (tx.version !== 2 || tx.lockTime !== 0) {
    throw new Error("Settlement transaction version or locktime is not the expected policy.");
  }

  const input = tx.getInput(0);
  allowedObjectKeys(
    input,
    [
      "txid",
      "index",
      "sequence",
      "witnessUtxo",
      "witnessScript",
      "sighashType",
      "bip32Derivation",
      "partialSig",
    ],
    "Settlement input",
  );
  if (
    !input.txid ||
    hex.encode(input.txid).toLowerCase() !== policy.funding_txid.toLowerCase() ||
    input.index !== policy.funding_vout
  ) {
    throw new Error("Settlement input does not spend the verified escrow funding outpoint.");
  }
  if (
    input.sequence !== SETTLEMENT_SEQUENCE ||
    !input.witnessUtxo ||
    input.witnessUtxo.amount !== expectedAmount ||
    hex.encode(input.witnessUtxo.script).toLowerCase() !== policy.script_pubkey_hex.toLowerCase() ||
    !input.witnessScript ||
    hex.encode(input.witnessScript).toLowerCase() !== policy.witness_script_hex.toLowerCase() ||
    input.sighashType !== SIGHASH_ALL
  ) {
    throw new Error("Settlement input witness data, amount, script, sequence, or sighash is invalid.");
  }
  if (input.finalScriptSig || input.finalScriptWitness) {
    throw new Error("Submit partial PSBT signatures; finalized witnesses are not accepted here.");
  }
  const partialSigs = input.partialSig ?? [];
  if (!input.witnessScript || !input.witnessUtxo) {
    throw new Error("Settlement PSBT is missing the escrow witness data needed to verify signatures.");
  }
  const sighash = tx.preimageWitnessV0(
    0,
    input.witnessScript,
    SIGHASH_ALL,
    input.witnessUtxo.amount,
  );
  for (const [pubkey, signature] of partialSigs) {
    if (!participants.has(hex.encode(pubkey).toLowerCase())) {
      throw new Error("Settlement PSBT contains a signature from a nonparticipant key.");
    }
    if (signature.length < 9 || signature[signature.length - 1] !== SIGHASH_ALL) {
      throw new Error("Settlement signatures must use SIGHASH_ALL.");
    }
    try {
      const derSignature = secp256k1.Signature.fromBytes(signature.slice(0, -1), "der");
      if (!secp256k1.verify(derSignature.toBytes("compact"), sighash, pubkey, { prehash: false })) {
        throw new Error("invalid signature");
      }
    } catch {
      throw new Error("Settlement PSBT contains an invalid partial signature.");
    }
  }
  const derivations = input.bip32Derivation ?? [];
  if (derivations.some(([pubkey]) => !participants.has(hex.encode(pubkey).toLowerCase()))) {
    throw new Error("Escrow PSBT derivation metadata references a nonparticipant key.");
  }
  if (signerPubkey) {
    const signerKey = hex.encode(evenCompressedPubkey(signerPubkey));
    if (!participants.has(signerKey)) {
      throw new Error("Current identity is not a participant in this escrow script.");
    }
  }

  const output = tx.getOutput(0);
  allowedObjectKeys(output, ["amount", "script"], "Settlement output");
  if (!output.script || !bytesEqual(output.script, destination)) {
    throw new Error("Settlement output script does not match the signed destination address.");
  }
  if (typeof output.amount !== "bigint" || output.amount <= BigInt(0)) {
    throw new Error("Settlement output amount is missing or invalid.");
  }
  const fee = expectedAmount - output.amount;
  const maxFeeByBps = (expectedAmount * BigInt(policy.max_fee_bps)) / BigInt(10_000);
  if (
    fee < BigInt(policy.min_fee_sats) ||
    fee > BigInt(policy.max_fee_sats) ||
    fee > maxFeeByBps ||
    fee >= expectedAmount ||
    tx.fee !== fee
  ) {
    throw new Error("Settlement fee exceeds the configured policy or does not balance exactly.");
  }
  if (output.amount < BigInt(330)) {
    throw new Error("Settlement output is below the P2WSH dust limit.");
  }

  const outputs: PsbtOutputSummary[] = [
    {
      address: tx.getOutputAddress(0, network) ?? null,
      amount_sats: Number(output.amount),
      script_hex: hex.encode(output.script),
    },
  ];
  return {
    unsigned_txid: tx.id,
    fee_sats: Number(fee),
    inputs: [
      {
        txid: hex.encode(input.txid),
        vout: input.index,
        amount_sats: Number(input.witnessUtxo.amount),
        partial_sigs: partialSigs.length,
      },
    ],
    outputs,
    partial_sigs_total: partialSigs.length,
    partial_sig_pubkeys: partialSigs.map(([pubkey]) => hex.encode(pubkey).slice(2)),
    is_final: tx.isFinal,
  };
}

export function unsignedPsbtTxid(psbtBase64: string): string {
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64.trim()), {
    unknown: "strict",
    proprietary: "strict",
  });
  return tx.id;
}

export function summarizePsbt(
  psbtBase64: string,
  policy: SettlementPsbtPolicy,
): PsbtReviewSummary {
  return validateSettlementPsbt(psbtBase64, policy);
}

export function signPsbtWithSecret(
  psbtBase64: string,
  secretHex: string,
  policy: SettlementPsbtPolicy,
  signerPubkey: string,
): string {
  validateSettlementPsbt(psbtBase64, policy, signerPubkey);
  const normalized = normalizeSigner(secretHex, signerPubkey);
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64.trim()), {
    unknown: "strict",
    proprietary: "strict",
  });
  const signed = tx.sign(normalized.secret);
  if (signed !== 1) {
    throw new Error("Signing key did not produce exactly one escrow input signature.");
  }
  const signedPsbt = base64.encode(tx.toPSBT(0));
  validateSettlementPsbt(signedPsbt, policy, signerPubkey);
  return signedPsbt;
}

export function purposeLabel(purpose: string | null | undefined): string {
  switch (purpose) {
    case "refund_buyer":
      return "Refund buyer";
    case "payout_seller":
      return "Payout seller";
    default:
      return purpose?.trim() ? purpose : "Unknown purpose";
  }
}
