import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import { assertEvidenceIntegrity } from "../src/lib/evidence.ts";

test("accepts evidence bytes matching the recorded digest", async () => {
  const blob = new Blob(["item description"]);
  const digest = hex.encode(sha256(new TextEncoder().encode("item description")));
  await assertEvidenceIntegrity(blob, digest);
});

test("rejects tampered bytes and malformed evidence digests", async () => {
  await assert.rejects(
    assertEvidenceIntegrity(new Blob(["altered evidence"]), "00".repeat(32)),
    /does not match/,
  );
  await assert.rejects(assertEvidenceIntegrity(new Blob(["evidence"]), "invalid"), /invalid SHA-256/);
});

test("allows legacy evidence whose digest is absent", async () => {
  await assertEvidenceIntegrity(new Blob(["legacy evidence"]), null);
});