import assert from "node:assert/strict";
import { test } from "node:test";
import * as secp from "@noble/secp256k1";
import { hex } from "@scure/base";
import { Address } from "@scure/btc-signer/payment.js";
import {
  buildCreateDealInput,
  deriveEscrowPreview,
  formValuesFromPreparedDeal,
  parsePreparedDeal,
  preparedDealChecks,
} from "../src/lib/prepared-deal.ts";

const regtest = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const xonly = (seed) => hex.encode(secp.getPublicKey(new Uint8Array(32).fill(seed), true)).slice(2);
const address = (seed) => Address(regtest).encode({ type: "wpkh", hash: new Uint8Array(20).fill(seed) });
const now = new Date("2026-10-28T12:00:00Z");
const ctx = { network: "regtest", pilotMaxAmountSats: null, now };
const mediators = [{ pubkey: xonly(3), display_name: "Local demo mediator" }];

function config(overrides = {}) {
  const keys = [xonly(1), xonly(2), xonly(3)];
  const escrow = deriveEscrowPreview(keys, "regtest");
  return {
    schema_version: 1,
    kind: "opendeal.prepared_deal",
    generated_at: "2026-10-28T12:00:00Z",
    generator: "opendeal-tui 0.1.0",
    network: "regtest",
    settlement_model: "bitcoin_multisig_2of3",
    deal: {
      title: "Used laptop",
      amount_sats: 50000,
      currency: "BTC",
      delivery_deadline: "2026-10-31T12:00:00Z",
      acceptance_window_hours: 48,
      seller_payout_address: address(10),
      buyer_refund_address: address(11),
    },
    participants: {
      seller_pubkey: keys[0],
      buyer_pubkey: keys[1],
      mediator_pubkey: keys[2],
      mediator_display_name: "Local demo mediator",
    },
    escrow_preview: { ...escrow, script_type: "p2wsh_multisig_2of3_sorted" },
    ...overrides,
  };
}
const parse = (value, context = ctx) => parsePreparedDeal(JSON.stringify(value), context);

test("escrow derivation matches the Rust opendeal-bitcoin test vector", () => {
  // Same keys and address as crates/opendeal-tui/src/escrow.rs known_vector_matches_frontend_test.
  assert.equal(
    deriveEscrowPreview([xonly(1), xonly(2), xonly(3)], "regtest").address,
    "bcrt1q4vfzl47akjp7trmg06nnqxquu3a07h4dpdzhg9lluxvf8wxqd5xqs6c0c7",
  );
});

test("accepts a valid configuration and returns only whitelisted fields", () => {
  const result = parse(config());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.value.deal.amount_sats, 50000);
  assert.equal(result.value.deal.delivery_deadline, "2026-10-31T12:00:00.000Z");
  assert.equal(result.value.participants.mediator_display_name, "Local demo mediator");
});

test("rejects unsupported or missing schema versions", () => {
  const v2 = parse(config({ schema_version: 2 }));
  assert.equal(v2.ok, false);
  assert.match(v2.errors[0], /Unsupported schema_version 2/);
  const missing = config();
  delete missing.schema_version;
  assert.match(parse(missing).errors[0], /Missing schema_version/);
});

test("rejects unknown fields so secrets cannot be smuggled in", () => {
  assert.equal(parse(config({ seller_secret: "deadbeef" })).ok, false);
  const c = config();
  c.participants.private_key = "nope";
  assert.match(parse(c).errors.join(" "), /Unexpected field participants.private_key/);
  const d = config();
  d.deal.jwt = "eyJ";
  assert.equal(parse(d).ok, false);
});

test("rejects malformed values and mismatched network or escrow", () => {
  const cases = [
    (c) => (c.network = "testnet"),
    (c) => (c.settlement_model = "simulated"),
    (c) => (c.deal.amount_sats = 500),
    (c) => (c.deal.amount_sats = 1.5),
    (c) => (c.deal.title = " "),
    (c) => (c.deal.currency = "USD"),
    (c) => (c.deal.delivery_deadline = "2026-10-01T00:00:00Z"),
    (c) => (c.deal.acceptance_window_hours = 0),
    (c) => (c.deal.seller_payout_address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"),
    (c) => (c.deal.buyer_refund_address = "not-an-address"),
    (c) => (c.participants.buyer_pubkey = c.participants.seller_pubkey),
    (c) => (c.participants.buyer_pubkey = "00".repeat(32)),
    (c) => (c.participants.buyer_pubkey = c.participants.buyer_pubkey.toUpperCase()),
    (c) => (c.escrow_preview.address = deriveEscrowPreview([xonly(4), xonly(2), xonly(3)], "regtest").address),
    (c) => (c.escrow_preview.sorted_pubkeys = [...c.escrow_preview.sorted_pubkeys].reverse()),
  ];
  for (const mutate of cases) {
    const c = config();
    mutate(c);
    assert.equal(parse(c).ok, false, mutate.toString());
  }
  assert.equal(parse(config(), { ...ctx, pilotMaxAmountSats: 20000 }).ok, false);
  assert.equal(parse(config(), { ...ctx, network: "testnet" }).ok, false);
  assert.equal(parsePreparedDeal("{", ctx).ok, false);
  assert.equal(parsePreparedDeal("[]", ctx).ok, false);
  assert.equal(parsePreparedDeal(" ".repeat(17000), ctx).ok, false);
});

test("preview checks seller session and mediator approval before applying", () => {
  const deal = parse(config()).value;
  const signedInSeller = preparedDealChecks(deal, {
    sessionPubkey: `02${xonly(1)}`,
    approvedMediators: mediators,
  });
  assert.equal(signedInSeller.canApply, true);
  assert.ok(signedInSeller.checks.every((c) => c.ok));

  const wrongSession = preparedDealChecks(deal, { sessionPubkey: xonly(2), approvedMediators: mediators });
  assert.equal(wrongSession.checks.find((c) => c.label.startsWith("Seller")).ok, false);
  assert.equal(wrongSession.canApply, true);

  const unapproved = preparedDealChecks(deal, { sessionPubkey: xonly(1), approvedMediators: [] });
  assert.equal(unapproved.canApply, false);
});

test("applying fills the form and the create request carries server-checked constraints", () => {
  const deal = parse(config()).value;
  const { values, constraints } = formValuesFromPreparedDeal(deal);
  assert.equal(values.buyerPubkey, xonly(2));
  assert.equal(values.deliveryDeadline, "2026-10-31T12:00:00.000Z");
  const body = buildCreateDealInput(values, constraints, now);
  assert.deepEqual(body, {
    title: "Used laptop",
    amount_sats: 50000,
    buyer_pubkey: xonly(2),
    mediator_pubkey: xonly(3),
    delivery_deadline: "2026-10-31T12:00:00.000Z",
    acceptance_window_hours: 48,
    seller_payout_address: address(10),
    buyer_refund_address: address(11),
    seller_pubkey: xonly(1),
    network: "regtest",
    settlement_model: "bitcoin_multisig_2of3",
  });
  assert.equal("escrow_preview" in body, false);
});

test("manual deal creation payload is unchanged when nothing is imported", () => {
  const body = buildCreateDealInput(
    {
      title: "Used laptop",
      description: "  ",
      amountSats: "50000",
      buyerPubkey: ` ${xonly(2)} `,
      mediatorPubkey: xonly(3),
      sellerPayoutAddress: address(10),
      buyerRefundAddress: address(11),
      deliveryDeadline: null,
      acceptanceWindowHours: 48,
    },
    null,
    now,
  );
  assert.deepEqual(Object.keys(body).sort(), [
    "acceptance_window_hours",
    "amount_sats",
    "buyer_pubkey",
    "buyer_refund_address",
    "delivery_deadline",
    "mediator_pubkey",
    "seller_payout_address",
    "title",
  ]);
  assert.equal(body.buyer_pubkey, xonly(2));
  assert.equal(body.delivery_deadline, "2026-10-31T12:00:00.000Z");
});
