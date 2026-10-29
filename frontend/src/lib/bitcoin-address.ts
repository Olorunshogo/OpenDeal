import { Address } from "@scure/btc-signer/payment.js";
import { networkParams, type BitcoinNetworkName } from "./psbt.ts";

export function validateBitcoinAddressForNetwork(
  address: string,
  network: BitcoinNetworkName,
): void {
  if (!address.trim()) {
    throw new Error("Bitcoin address is required.");
  }
  try {
    Address(networkParams(network)).decode(address.trim());
  } catch {
    throw new Error(`Address is invalid for the configured ${network} network.`);
  }
}

export function bitcoinAddressError(address: string, network: BitcoinNetworkName): string | null {
  try {
    validateBitcoinAddressForNetwork(address, network);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid Bitcoin address.";
  }
}
