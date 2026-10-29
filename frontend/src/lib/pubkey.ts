const PUBKEY_PATTERN: RegExp = /^(02|03)?[0-9a-fA-F]{64}$/;

export function pubkeyError(value: string): string | null {
  return PUBKEY_PATTERN.test(value)
    ? null
    : "Enter a 64-character x-only or 66-character compressed public key in hex.";
}
