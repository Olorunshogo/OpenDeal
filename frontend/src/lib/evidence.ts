import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";

export async function assertEvidenceIntegrity(
  blob: Blob,
  expectedSha256: string | null,
): Promise<void> {
  if (expectedSha256 === null) {
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new Error("Evidence has an invalid SHA-256 digest.");
  }
  const actual = hex.encode(sha256(new Uint8Array(await blob.arrayBuffer())));
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error("Downloaded evidence does not match its recorded SHA-256 digest.");
  }
}