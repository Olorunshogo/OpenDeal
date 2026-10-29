import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyEvent } from "nostr-tools/pure";

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
  },
  addEventListener() {},
  removeEventListener() {},
};

const vault = await import("../src/lib/identity-vault.ts");
const device = await import("../src/lib/device-identity.ts");
const { createAndSignIn, signInWithSecret, unlockIdentity } = await import("../src/lib/identity-session.ts");
const { normPubkey, pubkeyFromSecret } = await import("../src/lib/crypto.ts");
const { clearSession, getSigningCapability, loadSession, saveSession, setSigningCapability } =
  await import("../src/lib/session.ts");

const phrase = "a long enough recovery passphrase";
const secret = (n) => n.toString(16).padStart(64, "0");
const pub = (s) => normPubkey(pubkeyFromSecret(s));

// Legacy three-participant workspace envelope, built the way the old page encrypted it.
async function legacyEnvelope(role, s) {
  const enc = new TextEncoder();
  const b64 = (b) => btoa(String.fromCharCode(...b));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", enc.encode(phrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(`OpenDeal demo identity v1:${role}:${pub(s)}`) },
    key,
    enc.encode(s),
  );
  return { version: 1, role, pubkey: pub(s), salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) };
}

/** Mock API that only implements Nostr challenge login and records every URL. */
function mockApi() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    if (url.endsWith("/auth/nostr/challenge")) return Response.json({ success: true, data: { nonce: `nonce-${body.pubkey}` } });
    if (url.endsWith("/auth/nostr/login")) {
      assert.equal(verifyEvent(body.event), true, "login event must be validly signed");
      assert.equal(body.event.content, `nonce-${body.event.pubkey}`);
      return Response.json({ success: true, data: { pubkey: body.event.pubkey, token: `jwt-${body.event.pubkey.slice(0, 6)}` } });
    }
    return Response.json({ success: false, message: "unexpected route" }, { status: 404 });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("create: new identity file is encrypted, single-identity, and restorable", async () => {
  const { file, secret: s } = await vault.createIdentity(phrase);
  const text = JSON.stringify(file);
  assert.equal(file.kind, "opendeal.identity");
  assert.equal(text.includes(s), false, "no plaintext secret in the file");
  const [candidate] = vault.parseRecoveryFile(text);
  assert.equal(candidate.envelope.pubkey, pub(s));
  assert.equal(await vault.decryptIdentity(candidate.envelope, phrase), s);
  await assert.rejects(vault.decryptIdentity(candidate.envelope, "wrong passphrase!!"), /Cannot unlock/);
  await assert.rejects(vault.createIdentity("short"), /at least 12/);
});

test("restore: tampering, relabelling and malformed files are rejected", async () => {
  const a = await vault.encryptIdentity(secret(1), phrase);
  const b = await vault.encryptIdentity(secret(2), phrase);
  await assert.rejects(vault.decryptIdentity({ ...a, pubkey: b.pubkey }, phrase), /Cannot unlock/);
  await assert.rejects(vault.decryptIdentity({ ...a, ciphertext: b.ciphertext }, phrase), /Cannot unlock/);
  assert.throws(() => vault.parseRecoveryFile("x".repeat(64001)), /too large/);
  assert.throws(() => vault.parseRecoveryFile("{"), /not valid JSON/);
  assert.throws(() => vault.parseRecoveryFile(JSON.stringify({ version: 2 })), /Unsupported/);
  const file = vault.identityFileFor(a);
  const bad = { ...file, identity: { ...file.identity, pubkey: "zz" } };
  assert.throws(() => vault.parseRecoveryFile(JSON.stringify(bad)), /Invalid/);
  const smuggled = { ...file, identity: { ...file.identity, secret: secret(1) } };
  assert.equal(JSON.stringify(vault.parseRecoveryFile(JSON.stringify(smuggled))).includes(secret(1)), false);
});

test("restore: earlier three-participant workspace files still unlock", async () => {
  const workspace = {
    version: 1,
    createdAt: new Date().toISOString(),
    participants: {
      seller: await legacyEnvelope("seller", secret(1)),
      buyer: await legacyEnvelope("buyer", secret(2)),
      mediator: await legacyEnvelope("mediator", secret(3)),
    },
  };
  const candidates = vault.parseRecoveryFile(JSON.stringify(workspace));
  assert.deepEqual(candidates.map((c) => c.envelope.legacyRole), ["seller", "buyer", "mediator"]);
  assert.equal(await vault.decryptIdentity(candidates[1].envelope, phrase), secret(2));
  assert.throws(() => vault.identityFileFor(candidates[0].envelope), /Re-encrypt/);
  const dup = structuredClone(workspace);
  dup.participants.buyer = dup.participants.seller;
  assert.throws(() => vault.parseRecoveryFile(JSON.stringify(dup)));
});

test("device storage is opt-in and holds only the encrypted envelope", async () => {
  values.clear();
  assert.equal(device.loadDeviceIdentity(), null);
  const envelope = await vault.encryptIdentity(secret(4), phrase);
  device.saveDeviceIdentity(envelope);
  const stored = [...values.values()].join("");
  assert.equal(stored.includes(secret(4)), false);
  assert.equal(device.loadDeviceIdentity().pubkey, envelope.pubkey);
  device.forgetDeviceIdentity();
  assert.equal(device.loadDeviceIdentity(), null);
  values.set("opendeal.identity.encrypted", "garbage");
  assert.equal(device.loadDeviceIdentity(), null, "junk is discarded");
});

test("sign-in proves key possession via Nostr challenge and never uses the dev session route", async () => {
  values.clear();
  const api = mockApi();
  try {
    const file = await createAndSignIn(phrase, () => {});
    const session = loadSession();
    assert.equal(session.pubkey, file.identity.pubkey);
    assert.ok(getSigningCapability(session.pubkey), "signer is unlocked in memory");
    assert.equal(JSON.stringify([...values.values()]).includes(getSigningCapability(session.pubkey)), false);
    await signInWithSecret(secret(5), () => {});
    assert.equal(loadSession().pubkey, pub(secret(5)));
    assert.ok(api.calls.every((u) => !u.includes("/auth/dev/")), api.calls.join("\n"));
    assert.ok(api.calls.some((u) => u.endsWith("/auth/nostr/login")));
  } finally {
    api.restore();
    clearSession();
  }
});

test("switching identity replaces session and signer together and clears private data", async () => {
  values.clear();
  const api = mockApi();
  const seller = await vault.encryptIdentity(secret(1), phrase);
  const buyer = await vault.encryptIdentity(secret(2), phrase);
  let cleared = 0;
  try {
    await unlockIdentity(seller, phrase, () => cleared++);
    assert.equal(getSigningCapability(seller.pubkey), secret(1));
    await unlockIdentity(buyer, phrase, () => {
      assert.equal(getSigningCapability(seller.pubkey), null);
      cleared++;
    });
    assert.equal(loadSession().pubkey, buyer.pubkey);
    assert.equal(cleared, 2);
    await assert.rejects(unlockIdentity(seller, "incorrect passphrase", () => assert.fail("must not switch")), /Cannot unlock/);
    assert.equal(loadSession().pubkey, buyer.pubkey);
  } finally {
    api.restore();
    clearSession();
  }
});

test("legacy envelopes are re-encrypted to the standard format after unlock", async () => {
  values.clear();
  const api = mockApi();
  try {
    const legacy = vault.parseRecoveryFile(
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        participants: {
          seller: await legacyEnvelope("seller", secret(1)),
          buyer: await legacyEnvelope("buyer", secret(2)),
          mediator: await legacyEnvelope("mediator", secret(3)),
        },
      }),
    )[0].envelope;
    const upgraded = await unlockIdentity(legacy, phrase, () => {});
    assert.equal(upgraded.legacyRole, undefined);
    assert.equal(await vault.decryptIdentity(upgraded, phrase), secret(1));
    assert.ok(vault.identityFileFor(upgraded));
  } finally {
    api.restore();
    clearSession();
  }
});

test("a mismatched login response or concurrent session change cannot replace the identity", async () => {
  values.clear();
  saveSession({ token: "existing", pubkey: "11".repeat(32), roleLabel: "buyer" });
  setSigningCapability("11".repeat(32), secret(9));
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    Response.json({ success: true, data: url.endsWith("/challenge") ? { nonce: "n" } : { pubkey: "22".repeat(32), token: "wrong" } });
  try {
    await assert.rejects(signInWithSecret(secret(1), () => {}), /does not match/);
    assert.equal(loadSession().token, "existing");
    assert.equal(getSigningCapability("11".repeat(32)), secret(9));
  } finally {
    globalThis.fetch = original;
  }
  let finish;
  globalThis.fetch = async (url) =>
    url.endsWith("/challenge")
      ? Response.json({ success: true, data: { nonce: "n" } })
      : new Promise((resolve) => (finish = () => resolve(Response.json({ success: true, data: { pubkey: pub(secret(1)), token: "late" } }))));
  try {
    const pending = signInWithSecret(secret(1), () => {});
    while (!finish) await new Promise((r) => setTimeout(r, 5));
    saveSession({ token: "newer", pubkey: "33".repeat(32), roleLabel: "buyer" });
    finish();
    await assert.rejects(pending, /session changed/);
    assert.equal(loadSession().token, "newer");
    assert.equal(getSigningCapability(pub(secret(1))), null);
  } finally {
    globalThis.fetch = original;
    clearSession();
  }
});
