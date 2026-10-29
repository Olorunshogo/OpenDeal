import assert from "node:assert/strict";
import { test } from "node:test";
import { actionBlockedReason, canMediatorResolve, canParticipantAct } from "../src/lib/workflow.ts";

test("mediators cannot use buyer/seller-only lifecycle actions", () => {
  for (const action of ["sign", "submit_evidence", "open_dispute", "ship", "accept"]) {
    assert.equal(canParticipantAct(action, "draft", "mediator"), false, action);
  }
  assert.equal(canParticipantAct("open_dispute", "funded", "mediator"), false);
});

test("party actions are restricted to permitted roles and states", () => {
  assert.equal(canParticipantAct("sign", "draft", "buyer"), true);
  assert.equal(canParticipantAct("sign", "agreed", "seller"), false);
  assert.equal(canParticipantAct("ship", "funded", "seller"), true);
  assert.equal(canParticipantAct("ship", "funded", "buyer"), false);
  assert.equal(canParticipantAct("accept", "shipped", "buyer"), true);
  assert.equal(canParticipantAct("open_dispute", "accepted", "buyer"), true);
  assert.equal(canParticipantAct("open_dispute", "awaiting_payment", "buyer"), false);
  assert.equal(canParticipantAct("open_dispute", "funded", "seller", true), false);
});

test("mediator resolution requires server-authorized list access, open details, and rationale", () => {
  assert.equal(canMediatorResolve(true, "open", true, "Evidence reviewed"), true);
  assert.equal(canMediatorResolve(false, "open", true, "Evidence reviewed"), false);
  assert.equal(canMediatorResolve(true, "resolved", true, "Evidence reviewed"), false);
  assert.equal(canMediatorResolve(true, "open", false, "Evidence reviewed"), false);
  assert.equal(canMediatorResolve(true, "open", true, "  "), false);
});

test("disabled actions explain why, and available actions have no reason", () => {
  assert.equal(actionBlockedReason("prepare_funding", "agreed", "seller"), null);
  assert.match(actionBlockedReason("prepare_funding", "draft", "buyer"), /sign the agreement/);
  assert.match(actionBlockedReason("prepare_funding", "funded", "buyer"), /already funded/);
  assert.equal(actionBlockedReason("verify_funding", "awaiting_payment", "buyer"), null);
  assert.match(actionBlockedReason("verify_funding", "agreed", "seller"), /Prepare funding/);
  assert.equal(actionBlockedReason("ship", "funded", "seller"), null);
  assert.match(actionBlockedReason("ship", "funded", "buyer"), /Only the seller/);
  assert.match(actionBlockedReason("ship", "agreed", "seller"), /funded/);
  assert.match(actionBlockedReason("ship", "accepted", "seller"), /Already/);
  assert.equal(actionBlockedReason("accept", "shipped", "buyer"), null);
  assert.match(actionBlockedReason("accept", "funded", "buyer"), /Waiting for the seller/);
  assert.match(actionBlockedReason("accept", "shipped", "seller"), /Only the buyer/);
  assert.equal(actionBlockedReason("open_dispute", "funded", "buyer"), null);
  assert.match(actionBlockedReason("open_dispute", "funded", "buyer", true), /settlement/);
  assert.match(actionBlockedReason("open_dispute", "funded", "mediator"), /buyer or seller/);
  assert.match(actionBlockedReason("ship", "funded", "other"), /not a participant/);
  for (const action of ["prepare_funding", "verify_funding", "ship", "accept", "open_dispute"]) {
    for (const status of ["draft", "agreed", "awaiting_payment", "funded", "shipped", "accepted", "settled", "disputed"]) {
      for (const role of ["seller", "buyer", "mediator", "other"]) {
        const reason = actionBlockedReason(action, status, role);
        assert.ok(reason === null || reason.length > 0, `${action}/${status}/${role}`);
      }
    }
  }
});
