import { finalizeEvent, type EventTemplate } from "nostr-tools/pure";

const LOGIN_KIND = 22242;

export type Nip07 = {
  getPublicKey: () => Promise<string>;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<{
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }>;
};

declare global {
  interface Window {
    nostr?: Nip07;
  }
}

export function hasNip07(): boolean {
  return typeof window !== "undefined" && Boolean(window.nostr?.getPublicKey);
}

export async function signLoginEventWithExtension(
  nonce: string,
  relayHint = "wss://relay.damus.io",
): Promise<unknown> {
  if (!window.nostr) {
    throw new Error("No Nostr extension found (install Alby or nos2x)");
  }
  const pubkey = await window.nostr.getPublicKey();
  const template = {
    kind: LOGIN_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["challenge", nonce],
      ["relay", relayHint],
    ],
    content: nonce,
  };
  const signed = await window.nostr.signEvent(template);
  if (signed.content !== nonce) {
    throw new Error("extension did not preserve challenge content");
  }
  if (signed.pubkey && signed.pubkey !== pubkey) {
    throw new Error("extension pubkey mismatch");
  }
  return signed;
}

export function signLoginEventWithSecret(secretHex: string, nonce: string): unknown {
  const clean = secretHex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length !== 64) {
    throw new Error("secret must be 32-byte hex");
  }
  const sk = Uint8Array.from(clean.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));
  const template: EventTemplate = {
    kind: LOGIN_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["challenge", nonce],
      ["u", "opendeal"],
    ],
    content: nonce,
  };
  return finalizeEvent(template, sk);
}
