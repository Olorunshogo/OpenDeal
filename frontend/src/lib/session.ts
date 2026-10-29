import { useSyncExternalStore } from "react";

export interface Session {
  token: string;
  pubkey: string;
  // Local display preference only; never an authorization claim.
  roleLabel: string;
}

const KEY = "opendeal.session";
let signingCapability: { pubkey: string; secret: string } | null = null;

function normalizedPubkey(pubkey: string): string {
  const normalized = pubkey.trim().toLowerCase();
  return /^(02|03)[0-9a-f]{64}$/.test(normalized) ? normalized.slice(2) : normalized;
}

function clearSigningCapability(): void {
  signingCapability = null;
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    const record = stored as Record<string, unknown>;
    if (
      typeof record.token !== "string" ||
      typeof record.pubkey !== "string" ||
      !record.pubkey.trim() ||
      typeof record.roleLabel !== "string"
    ) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    const session: Session = {
      token: record.token,
      pubkey: record.pubkey,
      roleLabel: record.roleLabel,
    };
    const sanitized = JSON.stringify(session);
    if (raw !== sanitized) {
      window.localStorage.setItem(KEY, sanitized);
    }
    return session;
  } catch {
    window.localStorage.removeItem(KEY);
    return null;
  }
}

export function saveSession(session: Session): void {
  const current = loadSession();
  if (current && normalizedPubkey(current.pubkey) !== normalizedPubkey(session.pubkey)) {
    clearSigningCapability();
  }
  const safeSession: Session = {
    token: session.token,
    pubkey: session.pubkey,
    roleLabel: session.roleLabel,
  };
  window.localStorage.setItem(KEY, JSON.stringify(safeSession));
  notify();
}

export function clearSession(): void {
  clearSigningCapability();
  window.localStorage.removeItem(KEY);
  notify();
}

export function updateSessionRoleLabel(roleLabel: string): void {
  if (!["seller", "buyer", "mediator"].includes(roleLabel)) {
    throw new Error("Choose seller, buyer, or mediator as the local test label.");
  }
  const current = loadSession();
  if (current) {
    saveSession({ ...current, roleLabel });
  }
}

export function setSigningCapability(pubkey: string, secret: string): void {
  signingCapability = { pubkey: normalizedPubkey(pubkey), secret };
  notify();
}

export function getSigningCapability(pubkey: string): string | null {
  if (signingCapability?.pubkey !== normalizedPubkey(pubkey)) {
    return null;
  }
  return signingCapability.secret;
}

export function useHasSigningCapability(pubkey?: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(pubkey && signingCapability?.pubkey === normalizedPubkey(pubkey)),
    () => false,
  );
}

export function expireSession(expectedToken?: string): void {
  const current: Session | null = loadSession();
  if (current?.token && (!expectedToken || current.token === expectedToken)) {
    saveSession({ ...current, token: "" });
  }
}

// === Hook

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Other tabs signing in or out fire `storage`; same-tab writes go through notify()
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): Session | null {
  const raw = window.localStorage.getItem(KEY);
  // useSyncExternalStore needs a stable reference until the stored value changes
  if (raw !== cachedRaw) {
    const previousPubkey = cachedSession?.pubkey;
    cachedRaw = raw;
    cachedSession = loadSession();
    if (
      previousPubkey &&
      normalizedPubkey(previousPubkey) !== normalizedPubkey(cachedSession?.pubkey ?? "")
    ) {
      clearSigningCapability();
    }
  }
  return cachedSession;
}

function getServerSnapshot(): Session | null {
  return null;
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
