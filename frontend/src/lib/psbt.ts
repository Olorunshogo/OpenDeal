import { base64, hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";

export type BitcoinNetworkName = "regtest" | "testnet" | "signet" | "bitcoin" | "mainnet" | string;

type NetworkParams = {
  bech32: string;
  pubKeyHash: number;
  scriptHash: number;
  wif: number;
};

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
  is_final: boolean;
}

const MAINNET: NetworkParams = { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 };
const TESTNET: NetworkParams = { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const REGTEST: NetworkParams = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const SIGNET: NetworkParams = { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

export function networkParams(network: BitcoinNetworkName): NetworkParams {
  switch (String(network).toLowerCase()) {
    case "bitcoin":
    case "mainnet":
      return MAINNET;
    case "testnet":
    case "testnet3":
      return TESTNET;
    case "signet":
      return SIGNET;
    case "regtest":
    default:
      return REGTEST;
  }
}

function hexToBytes(secretHex: string): Uint8Array {
  const clean = secretHex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length !== 64 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error("signing secret must be 32 bytes hex");
  }
  return hex.decode(clean);
}

export function summarizePsbt(psbtBase64: string, network: BitcoinNetworkName): PsbtReviewSummary {
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64.trim()));
  const net = networkParams(network);
  const inputs: PsbtInputSummary[] = [];
  let partialTotal = 0;

  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i);
    const sigs = input.partialSig?.length ?? 0;
    partialTotal += sigs;
    inputs.push({
      txid: input.txid ? hex.encode(input.txid) : "unknown",
      vout: Number(input.index ?? 0),
      amount_sats: input.witnessUtxo ? Number(input.witnessUtxo.amount) : null,
      partial_sigs: sigs,
    });
  }

  const outputs: PsbtOutputSummary[] = [];
  for (let i = 0; i < tx.outputsLength; i += 1) {
    const output = tx.getOutput(i);
    let address: string | null = null;
    try {
      address = tx.getOutputAddress(i, net) ?? null;
    } catch {
      address = null;
    }
    outputs.push({
      address,
      amount_sats: Number(output.amount ?? BigInt(0)),
      script_hex: output.script ? hex.encode(output.script) : "",
    });
  }

  return {
    unsigned_txid: tx.id,
    fee_sats: Number(tx.fee),
    inputs,
    outputs,
    partial_sigs_total: partialTotal,
    is_final: tx.isFinal,
  };
}

export function signPsbtWithSecret(psbtBase64: string, secretHex: string): string {
  const tx = Transaction.fromPSBT(base64.decode(psbtBase64.trim()));
  const secret = hexToBytes(secretHex);
  const signed = tx.sign(secret);
  if (signed < 1) {
    throw new Error("secret did not match any input key in this PSBT");
  }
  return base64.encode(tx.toPSBT(0));
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
