import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSession,
  getSigningCapability,
  loadSession,
  saveSession,
  setSigningCapability,
  updateSessionRoleLabel,
} from "../src/lib/session.ts";

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
};

test("session storage persists only JWT and public session fields", () => {
  const secret = "01".repeat(32);
  saveSession({ token: "token-a", pubkey: "11".repeat(32), roleLabel: "seller" });
  setSigningCapability("11".repeat(32), secret);
  assert.equal(getSigningCapability("11".repeat(32)), secret);
  assert.equal(values.get("opendeal.session").includes(secret), false);
  assert.deepEqual(loadSession(), {
    token: "token-a",
    pubkey: "11".repeat(32),
    roleLabel: "seller",
  });
});

test("changing the local role label preserves JWT, identity, and memory-only signing capability", () => {
  const pubkey = "11".repeat(32);
  const secret = "05".repeat(32);
  saveSession({ token: "same-token", pubkey, roleLabel: "seller" });
  setSigningCapability(pubkey, secret);
  for (const roleLabel of ["buyer", "mediator", "seller"]) {
    updateSessionRoleLabel(roleLabel);
    assert.deepEqual(loadSession(), { token: "same-token", pubkey, roleLabel });
    assert.equal(getSigningCapability(pubkey), secret);
    assert.equal(values.get("opendeal.session").includes(secret), false);
  }
  assert.throws(() => updateSessionRoleLabel("admin"), /local test label/);
  clearSession();
});

test("identity changes, legacy secret data, and logout clear signing capability", () => {
  saveSession({ token: "token-a", pubkey: "11".repeat(32), roleLabel: "seller" });
  setSigningCapability("11".repeat(32), "02".repeat(32));
  saveSession({ token: "token-b", pubkey: "22".repeat(32), roleLabel: "buyer" });
  assert.equal(getSigningCapability("11".repeat(32)), null);

  values.set(
    "opendeal.session",
    JSON.stringify({
      token: "legacy-token",
      pubkey: "22".repeat(32),
      roleLabel: "buyer",
      signingSecret: "03".repeat(32),
    }),
  );
  assert.equal(loadSession()?.pubkey, "22".repeat(32));
  assert.equal(values.get("opendeal.session").includes("signingSecret"), false);
  assert.equal(values.get("opendeal.session").includes("03".repeat(32)), false);

  setSigningCapability("22".repeat(32), "04".repeat(32));
  clearSession();
  assert.equal(getSigningCapability("22".repeat(32)), null);
});
