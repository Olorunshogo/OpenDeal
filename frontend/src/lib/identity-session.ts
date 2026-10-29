import { nostrLogin, requestNostrChallenge } from "./api.ts";
import { normPubkey, pubkeyFromSecret } from "./crypto.ts";
import {
  createIdentity,
  decryptIdentity,
  encryptIdentity,
  type EncryptedEnvelope,
  type IdentityFile,
} from "./identity-vault.ts";
import { signLoginEventWithSecret } from "./nostr.ts";
import {
  clearSession,
  loadSession,
  saveSession,
  setSigningCapability,
} from "./session.ts";

// Every sign-in proves possession of the key by signing a fresh Nostr challenge
// (POST /auth/nostr/challenge then /auth/nostr/login). There is no pubkey-only path.

let switching = false;

export async function signInWithSecret(
  secret: string,
  clearPrivateQueries: () => void,
  roleLabel?: string,
): Promise<void> {
  if (switching) throw new Error("Another sign-in is already in progress.");
  switching = true;
  try {
    const previous = loadSession();
    const pubkey = normPubkey(pubkeyFromSecret(secret));
    const { nonce } = await requestNostrChallenge(pubkey);
    const auth = await nostrLogin(signLoginEventWithSecret(secret, nonce));
    if (normPubkey(auth.pubkey) !== pubkey) {
      throw new Error("Authenticated identity does not match this signing key.");
    }
    const current = loadSession();
    if (previous?.pubkey !== current?.pubkey || previous?.token !== current?.token) {
      throw new Error("The active session changed while signing in. Try again.");
    }
    // Switching identity drops the old key and any cached private data first.
    clearSession();
    clearPrivateQueries();
    saveSession({
      token: auth.token,
      pubkey: auth.pubkey,
      roleLabel: roleLabel ?? previous?.roleLabel ?? "seller",
    });
    setSigningCapability(auth.pubkey, secret);
  } finally {
    switching = false;
  }
}

/**
 * Decrypts one envelope in memory and signs in with it. Returns a standard (non-role-bound)
 * envelope for the same key, re-encrypted with the same passphrase when the input came from an
 * earlier workspace file, so callers can store or export it without ever handling the secret.
 */
export async function unlockIdentity(
  envelope: EncryptedEnvelope,
  passphrase: string,
  clearPrivateQueries: () => void,
): Promise<EncryptedEnvelope> {
  if (switching) throw new Error("Another sign-in is already in progress.");
  const secret = await decryptIdentity(envelope, passphrase);
  await signInWithSecret(secret, clearPrivateQueries, envelope.legacyRole);
  return envelope.legacyRole ? encryptIdentity(secret, passphrase) : envelope;
}

/** Creates a new identity, signs in with it, and returns only its encrypted recovery file. */
export async function createAndSignIn(
  passphrase: string,
  clearPrivateQueries: () => void,
): Promise<IdentityFile> {
  const { file, secret } = await createIdentity(passphrase);
  await signInWithSecret(secret, clearPrivateQueries);
  return file;
}
