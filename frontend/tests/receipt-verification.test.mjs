import assert from "node:assert/strict";
import { test } from "node:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp from "@noble/secp256k1";
import { verifyDealReceipt } from "../src/lib/receipt-verification.ts";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key, message) => hmac(sha256, key, message);

const secrets = [1, 2, 3].map((value) => Uint8Array.from([...new Uint8Array(31), value]));
const pubkeys = secrets.map((secret) => secp.getPublicKey(secret, true));
const agreement = {
  version: 1,
  title: "Used laptop",
  seller_payout_address: "bcrt1seller",
  buyer_refund_address: "bcrt1buyer",
  amount_sats: 50000,
  currency: "BTC",
  seller_pubkey: Buffer.from(pubkeys[0].slice(1)).toString("hex"),
  buyer_pubkey: Buffer.from(pubkeys[1].slice(1)).toString("hex"),
  mediator_pubkey: Buffer.from(pubkeys[2].slice(1)).toString("hex"),
  delivery_deadline: "2026-12-01T12:00:00Z",
  acceptance_window_hours: 48,
  settlement_model: "bitcoin_multisig_2of3",
  network: "regtest",
  created_at: "2026-10-25T12:00:00Z",
};

const agreementBytes = new TextEncoder().encode(JSON.stringify(agreement));
const agreementId = Buffer.from(sha256(agreementBytes)).toString("hex");

function signatureFor(bytes, secret) {
  return {
    sig: Buffer.from(secp.sign(sha256(bytes), secret, { prehash: false })).toString("hex"),
    pubkey: Buffer.from(secp.getPublicKey(secret, true)).toString("hex"),
  };
}

function makeEvents(extraPayloads = []) {
  const events = [];
  let prevEventHash = "";
  const payloads = [
    ["deal_created", { type: "deal_created", agreement_id: agreementId }],
    ["agreement_signed", { type: "agreement_signed", role: "seller", pubkey: agreement.seller_pubkey }],
    ["agreement_signed", { type: "agreement_signed", role: "buyer", pubkey: agreement.buyer_pubkey }],
    ["status_transitioned", { type: "status_transitioned", from: "draft", to: "agreed" }],
    ...extraPayloads,
  ];
  for (let sequence = 0; sequence < payloads.length; sequence += 1) {
    const [kind, payload] = payloads[sequence];
    const event = {
      agreement_id: agreementId,
      sequence,
      kind,
      payload,
      actor_pubkey: agreement.seller_pubkey,
      prev_event_hash: prevEventHash,
      created_at: "2026-10-25T12:00:00Z",
      signature: null,
    };
    const signable = {
      agreement_id: event.agreement_id,
      sequence: event.sequence,
      kind: event.kind,
      payload: event.payload,
      actor_pubkey: event.actor_pubkey,
      prev_event_hash: event.prev_event_hash,
      created_at: event.created_at,
    };
    prevEventHash = Buffer.from(sha256(new TextEncoder().encode(JSON.stringify(signable)))).toString("hex");
    events.push(event);
  }
  return events;
}

function validReceipt() {
  return {
    agreement,
    agreement_id: agreementId,
    status: "agreed",
    settlement_model: agreement.settlement_model,
    network: agreement.network,
    agreement_signatures: [signatureFor(agreementBytes, secrets[0]), signatureFor(agreementBytes, secrets[1])],
    events: makeEvents(),
    funding_txid: null,
    settlement_txid: null,
  };
}

test("verifies a valid receipt and reports chain-proof limitations", () => {
  const result = verifyDealReceipt(validReceipt());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.limitations.length, 2);
    assert.match(result.limitations[1], /active Bitcoin chain/);
  }
});

test("rejects agreement, signature, event-chain, and status tampering", () => {
  const receipt = validReceipt();
  assert.equal(verifyDealReceipt({ ...receipt, agreement: { ...agreement, amount_sats: 51000 } }).valid, false);

  const badSignature = validReceipt();
  badSignature.agreement_signatures[0].sig = "00".repeat(64);
  assert.equal(verifyDealReceipt(badSignature).valid, false);

  const badEvent = validReceipt();
  badEvent.events[2].sequence = 8;
  assert.equal(verifyDealReceipt(badEvent).valid, false);

  assert.equal(verifyDealReceipt({ ...receipt, status: "settled" }).valid, false);
});

test("accepts terminal settlement only with matching confirmation evidence", () => {
  const fundingTxid = "44".repeat(32);
  const settlementTxid = "55".repeat(32);
  const extraPayloads = [
    ["status_transitioned", { type: "status_transitioned", from: "agreed", to: "awaiting_payment" }],
    ["funding_detected", { type: "funding_detected", txid: fundingTxid, vout: 0, amount_sats: 50000 }],
    ["funding_confirmed", { type: "funding_confirmed", txid: fundingTxid, vout: 0, confirmations: 1 }],
    ["status_transitioned", { type: "status_transitioned", from: "awaiting_payment", to: "funded" }],
    ["status_transitioned", { type: "status_transitioned", from: "funded", to: "shipped" }],
    ["status_transitioned", { type: "status_transitioned", from: "shipped", to: "accepted" }],
    ["settlement_broadcast_requested", { type: "settlement_broadcast_requested", txid: settlementTxid }],
    ["settlement_broadcast", { type: "settlement_broadcast", txid: settlementTxid }],
    ["settlement_confirmed", { type: "settlement_confirmed", txid: settlementTxid, confirmations: 1, block_hash: "66".repeat(32) }],
    ["status_transitioned", { type: "status_transitioned", from: "accepted", to: "settled" }],
  ];
  const receipt = {
    ...validReceipt(),
    status: "settled",
    funding_txid: fundingTxid,
    settlement_txid: settlementTxid,
    events: makeEvents(extraPayloads),
  };
  assert.equal(verifyDealReceipt(receipt).valid, true);
  const withoutConfirmation = {
    ...receipt,
    events: receipt.events.filter((event) => event.kind !== "settlement_confirmed"),
  };
  assert.equal(verifyDealReceipt(withoutConfirmation).valid, false);
});
