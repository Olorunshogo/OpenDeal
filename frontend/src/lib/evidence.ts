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
const EVIDENCE_EXTENSIONS: Record<string, string> = {
  "text/plain": "txt",
  "application/json": "json",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function evidenceFileName(item: {
  id: string;
  object_key: string | null;
  content_type: string | null;
}): string {
  const contentType: string = item.object_key ? (item.content_type ?? "") : "text/plain";
  const extension: string = EVIDENCE_EXTENSIONS[contentType.split(";")[0].trim()] ?? "bin";
  return `evidence-${item.id.slice(0, 8)}.${extension}`;
}
