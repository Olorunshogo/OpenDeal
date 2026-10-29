import { generateIdentity, normPubkey, pubkeyFromSecret } from "./crypto.ts";

// Encrypted identity recovery. One user, one secp256k1 key (32-byte hex secret), encrypted with
// PBKDF2-SHA256 (310,000 iterations) + AES-GCM-256. The public key is bound as additional data,
// so an envelope cannot be relabelled. Plaintext secrets exist only in memory after unlock.
//
// Also reads the earlier three-participant workspace files (version 1 with `participants`).
// Their envelopes are role-bound and decrypt with their original additional data.

export const IDENTITY_FILE_KIND = "opendeal.identity";
export const MAX_IDENTITY_FILE_BYTES = 64_000;
export const MIN_PASSPHRASE_LENGTH = 12;
const LEGACY_ROLES = ["seller", "buyer", "mediator"] as const;
type LegacyRole = (typeof LEGACY_ROLES)[number];

export interface EncryptedEnvelope {
  pubkey: string;
  salt: string;
  iv: string;
  ciphertext: string;
  /** Present only for envelopes from legacy three-participant workspace files. */
  legacyRole?: LegacyRole;
}

export interface IdentityFile {
  version: 1;
  kind: typeof IDENTITY_FILE_KIND;
  createdAt: string;
  identity: EncryptedEnvelope;
}

export interface RestoreCandidate {
  label: string;
  envelope: EncryptedEnvelope;
}

const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function additionalData(envelope: Pick<EncryptedEnvelope, "pubkey" | "legacyRole">): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    envelope.legacyRole
      ? `OpenDeal demo identity v1:${envelope.legacyRole}:${envelope.pubkey}`
      : `OpenDeal identity v1:${envelope.pubkey}`,
  );
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Use a recovery passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310_000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptIdentity(secret: string, passphrase: string): Promise<EncryptedEnvelope> {
  const pubkey = normPubkey(pubkeyFromSecret(secret));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData({ pubkey }) },
    key,
    encoder.encode(secret),
  );
  return { pubkey, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Returns the 32-byte hex secret. Fails closed on a wrong passphrase or any tampering. */
export async function decryptIdentity(envelope: EncryptedEnvelope, passphrase: string): Promise<string> {
  try {
    const key = await deriveKey(passphrase, fromBase64(envelope.salt));
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: additionalData(envelope) },
      key,
      fromBase64(envelope.ciphertext),
    );
    const secret = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (normPubkey(pubkeyFromSecret(secret)) !== envelope.pubkey) throw new Error("mismatch");
    return secret;
  } catch (error) {
    if (error instanceof Error && error.message.includes("at least")) throw error;
    throw new Error("Cannot unlock this identity. Check the passphrase and recovery file.");
  }
}

/** Creates a new identity. The caller keeps `secret` in memory only. */
export async function createIdentity(
  passphrase: string,
): Promise<{ file: IdentityFile; secret: string }> {
  const { secretHex } = generateIdentity();
  const identity = await encryptIdentity(secretHex, passphrase);
  return {
    file: { version: 1, kind: IDENTITY_FILE_KIND, createdAt: new Date().toISOString(), identity },
    secret: secretHex,
  };
}

function validEnvelope(value: unknown, legacyRole?: LegacyRole): EncryptedEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  try {
    if (
      typeof v.pubkey !== "string" ||
      !/^[0-9a-f]{64}$/.test(v.pubkey) ||
      typeof v.salt !== "string" ||
      typeof v.iv !== "string" ||
      typeof v.ciphertext !== "string" ||
      fromBase64(v.salt).length !== 16 ||
      fromBase64(v.iv).length !== 12 ||
      // 64 hex chars of secret + 16-byte GCM tag
      fromBase64(v.ciphertext).length !== 80
    )
      return null;
  } catch {
    return null;
  }
  // Rebuild from whitelisted fields so nothing else is carried along.
  return {
    pubkey: v.pubkey,
    salt: v.salt,
    iv: v.iv,
    ciphertext: v.ciphertext,
    ...(legacyRole ? { legacyRole } : {}),
  };
}

/** Parses a recovery file into the identities it offers. Nothing is decrypted here. */
export function parseRecoveryFile(text: string): RestoreCandidate[] {
  if (text.length > MAX_IDENTITY_FILE_BYTES) throw new Error("Recovery file is too large.");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Recovery file is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || value.version !== 1) {
    throw new Error("Unsupported recovery file.");
  }
  if (value.kind === IDENTITY_FILE_KIND) {
    const envelope = validEnvelope(value.identity);
    if (!envelope) throw new Error("Invalid encrypted identity in recovery file.");
    return [{ label: "Identity", envelope }];
  }
  const participants = value.participants as Record<string, unknown> | undefined;
  if (participants && typeof participants === "object") {
    const candidates = LEGACY_ROLES.map((role) => {
      const raw = participants[role] as Record<string, unknown> | undefined;
      const envelope = raw && raw.role === role && raw.version === 1 ? validEnvelope(raw, role) : null;
      if (!envelope) throw new Error("Invalid encrypted identity in recovery file.");
      return { label: `${role[0].toUpperCase()}${role.slice(1)} (earlier workspace file)`, envelope };
    });
    if (new Set(candidates.map((c) => c.envelope.pubkey)).size !== 3) {
      throw new Error("Recovery file participants must be distinct.");
    }
    return candidates;
  }
  throw new Error("Unsupported recovery file.");
}

/** Serializes a recovery file containing only the encrypted envelope. */
export function identityFileFor(envelope: EncryptedEnvelope, createdAt = new Date().toISOString()): IdentityFile {
  if (envelope.legacyRole) {
    throw new Error("Re-encrypt earlier workspace identities before exporting them on their own.");
  }
  const safe = validEnvelope(envelope);
  if (!safe) throw new Error("Invalid encrypted identity.");
  return { version: 1, kind: IDENTITY_FILE_KIND, createdAt, identity: safe };
}
