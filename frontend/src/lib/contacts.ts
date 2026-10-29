import * as secp from "@noble/secp256k1";
import { hex } from "@scure/base";
import { normPubkey } from "./crypto.ts";
export interface Contact {
  name: string;
  pubkey: string;
}
const KEY = "opendeal.public-contacts";
export function validatedContact(name: string, pubkey: string): Contact {
  const key = normPubkey(pubkey);
  if (
    !name.trim() ||
    name.trim().length > 80 ||
    !/^[0-9a-f]{64}$/.test(key) ||
    !secp.utils.isValidPublicKey(hex.decode("02" + key))
  )
    throw new Error("Enter a name and a valid public key.");
  return { name: name.trim(), pubkey: key };
}
// Contacts the removed /demo page saved automatically. Dropped once, on next load.
const LEGACY_DEMO_NAMES = new Set(["Demo seller", "Demo buyer", "Demo mediator"]);

export function loadContacts(): Contact[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const contacts = value.map((c) => validatedContact(c.name, c.pubkey));
    const kept = contacts.filter((c) => !LEGACY_DEMO_NAMES.has(c.name));
    if (kept.length !== contacts.length) localStorage.setItem(KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return [];
  }
}

export function removeContact(pubkey: string): Contact[] {
  const next = loadContacts().filter((c) => c.pubkey !== pubkey);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
export function saveContact(contact: Contact): Contact[] {
  const safe = validatedContact(contact.name, contact.pubkey);
  const next = [
    ...loadContacts().filter((c) => c.pubkey !== safe.pubkey),
    safe,
  ];
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
