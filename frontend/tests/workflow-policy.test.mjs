import assert from "node:assert/strict";
import { test } from "node:test";
import { canMediatorResolve, canParticipantAct } from "../src/lib/workflow.ts";

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
