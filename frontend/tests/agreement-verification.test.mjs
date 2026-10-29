import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublicKey } from "@noble/secp256k1";
import { verifyCanonicalAgreement } from "../src/lib/agreement-verification.ts";

const participantPubkeys = [1, 2, 3].map((value) => {
  const secret = Uint8Array.from([...new Uint8Array(31), value]);
  return Buffer.from(getPublicKey(secret, true).slice(1)).toString("hex");
});

const agreement = {
  version: 1,
  title: "Used laptop",
  description: "Charger included",
  seller_payout_address: "bcrt1seller",
  buyer_refund_address: "bcrt1buyer",
  amount_sats: 50000,
  currency: "BTC",
  seller_pubkey: participantPubkeys[0],
  buyer_pubkey: participantPubkeys[1],
  mediator_pubkey: participantPubkeys[2],
  delivery_deadline: "2026-12-01T12:00:00Z",
  acceptance_window_hours: 48,
  settlement_model: "bitcoin_multisig_2of3",
  network: "regtest",
  created_at: "2026-10-25T12:00:00Z",
};

const deal = {
  id: "",
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
};

async function fixture(value = agreement) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const canonicalHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { canonicalHex, id };
}

test("accepts canonical agreement with required signed destinations", async () => {
  const data = await fixture();
  const result = verifyCanonicalAgreement(data.canonicalHex, agreement, { ...deal, id: data.id });
  assert.equal(result.valid, true, result.valid ? undefined : result.error);
});

test("rejects modified canonical bytes and an incorrect deal hash", async () => {
  const original = await fixture();
  const modified = await fixture({ ...agreement, amount_sats: 50001 });
  assert.equal(verifyCanonicalAgreement(modified.canonicalHex, agreement, { ...deal, id: original.id }).valid, false);
  assert.equal(verifyCanonicalAgreement(original.canonicalHex, agreement, { ...deal, id: "0".repeat(64) }).valid, false);
});

test("rejects malformed bytes and mismatch between envelope and canonical terms", async () => {
  const data = await fixture();
  assert.equal(verifyCanonicalAgreement("7b", agreement, { ...deal, id: data.id }).valid, false);
  assert.equal(
    verifyCanonicalAgreement(data.canonicalHex, { ...agreement, title: "Changed title" }, { ...deal, id: data.id }).valid,
    false,
  );
});

test("rejects missing signed destinations and disagreement with deal fields", async () => {
  const missingDestination = { ...agreement, seller_payout_address: "" };
  const missing = await fixture(missingDestination);
  assert.equal(
    verifyCanonicalAgreement(missing.canonicalHex, missingDestination, { ...deal, id: missing.id }).valid,
    false,
  );

  const data = await fixture();
  assert.equal(
    verifyCanonicalAgreement(data.canonicalHex, agreement, { ...deal, id: data.id, title: "Other" }).valid,
    false,
  );
});

test("rejects participant keys that are not points on secp256k1", async () => {
  const invalid = { ...agreement, buyer_pubkey: "ff".repeat(32) };
  const data = await fixture(invalid);
  assert.equal(verifyCanonicalAgreement(data.canonicalHex, invalid, { ...deal, id: data.id }).valid, false);
});

test("rejects duplicate buyer, seller, or mediator identities", async () => {
  const duplicate = { ...agreement, buyer_pubkey: agreement.seller_pubkey };
  const data = await fixture(duplicate);
  assert.equal(verifyCanonicalAgreement(data.canonicalHex, duplicate, { ...deal, id: data.id }).valid, false);
});

test("rejects canonical terms that are not rendered by the agreement review", async () => {
  const withHiddenTerm = { ...agreement, surprise_term: "not displayed" };
  const data = await fixture(withHiddenTerm);
  assert.equal(
    verifyCanonicalAgreement(data.canonicalHex, withHiddenTerm, { ...deal, id: data.id }).valid,
    false,
  );
});

test("rejects reordered JSON even when its digest is used as the ID", async () => {
  const reordered = Object.fromEntries(Object.entries(agreement).reverse());
  const data = await fixture(reordered);
  assert.equal(
    verifyCanonicalAgreement(data.canonicalHex, agreement, { ...deal, id: data.id }).valid,
    false,
  );
});
