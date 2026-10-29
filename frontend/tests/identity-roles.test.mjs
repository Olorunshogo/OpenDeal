import assert from "node:assert/strict";
import { test } from "node:test";
import { getPublicKey } from "@noble/secp256k1";
import { canParticipantAct, participantRoleForAgreement } from "../src/lib/workflow.ts";

const identities = [1, 2, 3].map((n) => {
  const secret = Uint8Array.from([...new Uint8Array(31), n]);
  const compressed = Buffer.from(getPublicKey(secret, true)).toString("hex");
  return { pubkey: compressed.slice(2), compressed };
});
const agreement = {
  seller_pubkey: identities[0].pubkey,
  buyer_pubkey: identities[1].pubkey,
  mediator_pubkey: identities[2].pubkey,
};

test("three identities on one agreement retain their actual role regardless of footer label", () => {
  for (const [index, expected] of ["seller", "buyer", "mediator"].entries()) {
    for (const roleLabel of ["seller", "buyer", "mediator"]) {
      const session = { ...identities[index], roleLabel };
      const role = participantRoleForAgreement(session.pubkey, agreement);
      assert.equal(role, expected);
      assert.equal(canParticipantAct("sign", "draft", role), expected !== "mediator");
      assert.equal(canParticipantAct("ship", "funded", role), expected === "seller");
      assert.equal(canParticipantAct("accept", "shipped", role), expected === "buyer");
      assert.equal(canParticipantAct("submit_evidence", "disputed", role), expected !== "mediator");
      assert.equal(canParticipantAct("open_dispute", "funded", role), expected !== "mediator");
    }
  }
});

test("deal roles normalize compressed and x-only public keys and follow identity changes", () => {
  assert.equal(participantRoleForAgreement(identities[1].compressed.toUpperCase(), agreement), "buyer");
  assert.equal(participantRoleForAgreement(identities[2].pubkey, {
    ...agreement, mediator_pubkey: identities[2].compressed,
  }), "mediator");
  assert.equal(participantRoleForAgreement(identities[0].pubkey, agreement), "seller");
  assert.equal(participantRoleForAgreement(identities[1].pubkey, agreement), "buyer");
  assert.equal(participantRoleForAgreement(null, agreement), "other");
  assert.equal(participantRoleForAgreement(identities[0].pubkey, null), "other");
  assert.equal(participantRoleForAgreement("not-a-public-key", agreement), "other");
  assert.equal(participantRoleForAgreement("00".repeat(32), agreement), "other");
});
