import assert from "node:assert/strict";
import { test } from "node:test";
import { Address } from "@scure/btc-signer/payment.js";
import { validateBitcoinAddressForNetwork } from "../src/lib/bitcoin-address.ts";

const regtest = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const testnet = { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const regtestAddress = Address(regtest).encode({ type: "wsh", hash: new Uint8Array(32) });
const testnetAddress = Address(testnet).encode({ type: "wsh", hash: new Uint8Array(32) });

test("accepts addresses for the configured network", () => {
  assert.doesNotThrow(() => validateBitcoinAddressForNetwork(regtestAddress, "regtest"));
  assert.doesNotThrow(() => validateBitcoinAddressForNetwork(testnetAddress, "testnet"));
});

test("rejects wrong-network, malformed, and unknown-network addresses", () => {
  assert.throws(() => validateBitcoinAddressForNetwork(testnetAddress, "regtest"));
  assert.throws(() => validateBitcoinAddressForNetwork("not-an-address", "regtest"));
  assert.throws(() => validateBitcoinAddressForNetwork(regtestAddress, "unknown"));
});
