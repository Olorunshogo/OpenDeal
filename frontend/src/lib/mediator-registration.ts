import { hex } from "@scure/base";
import { normPubkey, pubkeyFromSecret, signCanonicalBytes } from "./crypto.ts";
export function mediatorRegistrationSignature(
  secret: string,
  pubkey: string,
  name: string
) {
  const key = normPubkey(pubkey),
    displayName = name.trim();
  if (normPubkey(pubkeyFromSecret(secret)) !== key)
    throw new Error("Registration key does not match the active identity.");
  if (
    !displayName ||
    new TextEncoder().encode(displayName).length > 80 ||
    /[\r\n]/.test(displayName)
  )
    throw new Error("Use a display name of 1–80 bytes without line breaks.");
  return signCanonicalBytes(
    secret,
    hex.encode(
      new TextEncoder().encode(
        `OpenDeal mediator registration v1\n${key}\n${displayName}`
      )
    )
  );
}

export async function mediatorRegistrationEvent(pubkey: string, name: string) {
  const key = normPubkey(pubkey),
    displayName = name.trim();
  if (
    !displayName ||
    new TextEncoder().encode(displayName).length > 80 ||
    /[\r\n]/.test(displayName)
  )
    throw new Error("Use a display name of 1–80 bytes without line breaks.");
  if (!window.nostr || normPubkey(await window.nostr.getPublicKey()) !== key)
    throw new Error(
      "Connect a Nostr extension or matching local signing key for this application."
    );
  const event = await window.nostr.signEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["purpose", "opendeal-mediator-registration"]],
    content: `OpenDeal mediator registration v1\n${key}\n${displayName}`,
  });
  const { verifyEvent } = await import("nostr-tools/pure");
  if (
    !verifyEvent(event) ||
    event.pubkey !== key ||
    event.kind !== 22242 ||
    event.content !==
      `OpenDeal mediator registration v1\n${key}\n${displayName}`
  )
    throw new Error("Extension did not sign the requested registration terms.");
  return event;
}
