import { useSyncExternalStore } from "react";
import {
  identityFileFor,
  parseRecoveryFile,
  type EncryptedEnvelope,
} from "./identity-vault.ts";

// Opt-in "remember on this device": stores the ENCRYPTED recovery envelope only, never a
// plaintext key. Unlocking still needs the passphrase, then a signed Nostr challenge.
const KEY = "opendeal.identity.encrypted";

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadDeviceIdentity(): EncryptedEnvelope | null {
  const store = storage();
  const raw = store?.getItem(KEY);
  if (!store || !raw) return null;
  try {
    const candidates = parseRecoveryFile(raw);
    if (candidates.length !== 1 || candidates[0].envelope.legacyRole) throw new Error("unexpected");
    return candidates[0].envelope;
  } catch {
    store.removeItem(KEY);
    return null;
  }
}

export function saveDeviceIdentity(envelope: EncryptedEnvelope): void {
  const store = storage();
  if (!store) return;
  store.setItem(KEY, JSON.stringify(identityFileFor(envelope)));
  notify();
}

export function forgetDeviceIdentity(): void {
  storage()?.removeItem(KEY);
  notify();
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: EncryptedEnvelope | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function snapshot(): EncryptedEnvelope | null {
  const raw = storage()?.getItem(KEY) ?? null;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = loadDeviceIdentity();
  }
  return cached;
}

export function useDeviceIdentity(): EncryptedEnvelope | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
