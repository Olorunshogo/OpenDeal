import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp from "@noble/secp256k1";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, message: Uint8Array) => hmac(sha256, key, message);

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateIdentity(): { secretHex: string; pubkeyHex: string } {
  const secret = secp.utils.randomSecretKey();
  const pubkey = secp.getPublicKey(secret, true);
  return { secretHex: bytesToHex(secret), pubkeyHex: bytesToHex(pubkey) };
}

export function pubkeyFromSecret(secretHex: string): string {
  const secret = hexToBytes(secretHex);
  if (secret.length !== 32) {
    throw new Error("signing secret must be 32 bytes hex");
  }
  return bytesToHex(secp.getPublicKey(secret, true));
}

export function signCanonicalBytes(
  secretHex: string,
  canonicalHex: string,
): { sig: string; pubkey: string } {
  const secret = hexToBytes(secretHex);
  const canonical = hexToBytes(canonicalHex);
  if (secret.length !== 32) {
    throw new Error("signing secret must be 32 bytes hex");
  }
  const digest = sha256(canonical);
  const sig = secp.sign(digest, secret, { prehash: false });
  const pubkey = secp.getPublicKey(secret, true);
  return { sig: bytesToHex(sig), pubkey: bytesToHex(pubkey) };
}

export function normPubkey(pubkey: string): string {
  const lower = pubkey.trim().toLowerCase();
  if (lower.length === 66 && (lower.startsWith("02") || lower.startsWith("03"))) {
    return lower.slice(2);
  }
  return lower;
}
