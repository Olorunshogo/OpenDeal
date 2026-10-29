import assert from "node:assert/strict";
import { test } from "node:test";
import { base64, hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { sortedMultisig } from "@scure/btc-signer/payment.js";
import { getPublicKey } from "@noble/secp256k1";
import { signPsbtWithSecret, validateSettlementPsbt } from "../src/lib/psbt.ts";

const network = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const evenSecret = (value) => Uint8Array.from([...new Uint8Array(31), value]);
const oddSecret = Array.from({ length: 255 }, (_, index) => evenSecret(index + 1)).find(
  (secret) => getPublicKey(secret, true)[0] === 3,
);
assert.ok(oddSecret);
const secrets = [evenSecret(1), evenSecret(2), oddSecret];
const rawPubkeys = secrets.map((secret) => getPublicKey(secret, true));
const pubkeys = rawPubkeys.map((key) =>
  key[0] === 3 ? Uint8Array.from([2, ...key.slice(1)]) : key,
);
const participantXOnly = pubkeys.map((key) => hex.encode(key.slice(1)));
const escrow = sortedMultisig(2, pubkeys, true, network);
const payoutAddress = sortedMultisig(1, [pubkeys[1]], true, network).address;
const refundAddress = sortedMultisig(1, [pubkeys[0]], true, network).address;

const policy = {
  network: "regtest",
  expected_unsigned_txid: "",
  funding_txid: "0123456789abcdef".repeat(4),
  funding_vout: 3,
  funding_amount_sats: 50000,
  script_pubkey_hex: hex.encode(escrow.script),
  witness_script_hex: hex.encode(escrow.witnessScript),
  destination_address: payoutAddress,
  participant_pubkeys: participantXOnly,
  min_fee_sats: 200,
  max_fee_sats: 10000,
  max_fee_bps: 1000,
};

function createPsbt({
  fee = 500,
  address = payoutAddress,
  txid = policy.funding_txid,
  vout = policy.funding_vout,
  fundingAmount = policy.funding_amount_sats,
  extraInput = false,
  extraOutput = false,
  includeDerivations = true,
  scriptPubKey = escrow.script,
  witnessScript = escrow.witnessScript,
} = {}) {
  const tx = new Transaction({ version: 2, lockTime: 0 });
  const input = {
    txid: hex.decode(txid),
    index: vout,
    sequence: 0xfffffffd,
    witnessUtxo: { amount: BigInt(fundingAmount), script: scriptPubKey },
    witnessScript,
    sighashType: 1,
  };
  if (includeDerivations) {
    input.bip32Derivation = pubkeys.map((key) => [key, { fingerprint: 0, path: [] }]);
  }
  tx.addInput(input);
  if (extraInput) {
    tx.addInput({
      txid: hex.decode("cd".repeat(32)),
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { amount: 1000n, script: scriptPubKey },
      witnessScript,
      sighashType: 1,
      bip32Derivation: pubkeys.map((key) => [key, { fingerprint: 0, path: [] }]),
    });
  }
  tx.addOutputAddress(address, BigInt(fundingAmount - fee), network);
  if (extraOutput) {
    tx.addOutputAddress(refundAddress, 1n, network);
  }
  return base64.encode(tx.toPSBT(0));
}

policy.expected_unsigned_txid = Transaction.fromPSBT(base64.decode(createPsbt())).id;

test("accepts a valid single-input 2-of-3 settlement PSBT", () => {
  const result = validateSettlementPsbt(createPsbt(), policy, participantXOnly[0]);
  assert.equal(result.fee_sats, 500);
  assert.equal(result.inputs[0].txid, policy.funding_txid);
  assert.equal(result.outputs[0].address, payoutAddress);
});

test("rejects unsupported network, wrong destination, and wrong outpoint", () => {
  assert.throws(() => validateSettlementPsbt(createPsbt(), { ...policy, network: "unknown" }));
  assert.throws(() => validateSettlementPsbt(createPsbt({ address: refundAddress }), policy));
  assert.throws(() => validateSettlementPsbt(createPsbt({ txid: "cd".repeat(32) }), policy));
  const reversed = Uint8Array.from(Buffer.from(policy.funding_txid, "hex")).reverse();
  assert.throws(
    () => validateSettlementPsbt(createPsbt({ txid: Buffer.from(reversed).toString("hex") }), policy),
  );
});

test("rejects mismatched UTXO amount, excessive fee, and unexpected inputs or outputs", () => {
  assert.throws(() => validateSettlementPsbt(createPsbt({ fundingAmount: 49000 }), policy));
  assert.throws(() => validateSettlementPsbt(createPsbt({ fee: 6000 }), policy));
  assert.throws(() => validateSettlementPsbt(createPsbt({ extraInput: true }), policy));
  assert.throws(() => validateSettlementPsbt(createPsbt({ extraOutput: true }), policy));
});

test("accepts funding above the agreement minimum when the proposal spends the actual amount", () => {
  const overfundedPsbt = createPsbt({ fundingAmount: 55000 });
  const overfundedTxid = Transaction.fromPSBT(base64.decode(overfundedPsbt)).id;
  const result = validateSettlementPsbt(
    overfundedPsbt,
    {
      ...policy,
      expected_unsigned_txid: overfundedTxid,
      funding_amount_sats: 55000,
    },
  );
  assert.equal(result.fee_sats, 500);
  assert.equal(result.outputs[0].amount_sats, 54500);
});

test("accepts a wallet PSBT without optional BIP32 derivation metadata", () => {
  const psbt = createPsbt({ includeDerivations: false });
  assert.equal(validateSettlementPsbt(psbt, policy).fee_sats, 500);
});

test("rejects an invalid signer and normalizes odd- and even-Y signing keys", () => {
  assert.ok(rawPubkeys.some((key) => key[0] === 2));
  assert.ok(rawPubkeys.some((key) => key[0] === 3));
  const valid = createPsbt();
  assert.throws(() => signPsbtWithSecret(valid, "04".repeat(32), policy, participantXOnly[0]));

  for (let index = 0; index < secrets.length; index += 1) {
    const secret = secrets[index];
    const signature = signPsbtWithSecret(
      valid,
      hex.encode(secret),
      policy,
      participantXOnly[index],
    );
    assert.equal(validateSettlementPsbt(signature, policy, participantXOnly[index]).partial_sigs_total, 1);
  }
});

test("rejects a pasted PSBT whose external signer changes transaction policy", () => {
  const altered = createPsbt({ fee: 700 });
  assert.throws(() => validateSettlementPsbt(altered, policy, participantXOnly[0]));

  const signed = signPsbtWithSecret(
    createPsbt(),
    hex.encode(secrets[0]),
    policy,
    participantXOnly[0],
  );
  const signedTx = Transaction.fromPSBT(base64.decode(signed));
  const input = signedTx.getInput(0);
  const [pubkey, signature] = input.partialSig[0];
  signature[5] ^= 1;
  const tampered = Transaction.fromPSBT(base64.decode(createPsbt()));
  tampered.updateInput(0, { partialSig: [[pubkey, signature]] });
  assert.throws(
    () => validateSettlementPsbt(base64.encode(tampered.toPSBT(0)), policy, participantXOnly[0]),
    /invalid partial signature/,
  );
});
