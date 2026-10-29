"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/Input";
import { normPubkey } from "@/lib/crypto";
import { useDeviceIdentity } from "@/lib/device-identity";
import { unlockIdentity } from "@/lib/identity-session";
import {
  MAX_IDENTITY_FILE_BYTES,
  MIN_PASSPHRASE_LENGTH,
  parseRecoveryFile,
  type EncryptedEnvelope,
} from "@/lib/identity-vault";

/**
 * Shown where signing is needed but this tab holds no signing key (for example after a reload).
 * Unlocks the SAME identity in place, from this device's encrypted copy or the recovery file,
 * so the user never leaves the page. A file for a different identity is refused before decrypting.
 */
export function UnlockSigningKey({ pubkey }: { pubkey: string }) {
  const queryClient = useQueryClient();
  const deviceIdentity = useDeviceIdentity();
  const running = useRef(false);
  const [fileEnvelope, setFileEnvelope] = useState<EncryptedEnvelope | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const wanted = normPubkey(pubkey);
  const deviceMatch =
    deviceIdentity && normPubkey(deviceIdentity.pubkey) === wanted ? deviceIdentity : null;
  const envelope = fileEnvelope ?? deviceMatch;

  function onFile(file: File | undefined) {
    setError("");
    setFileEnvelope(null);
    if (!file) return;
    if (file.size > MAX_IDENTITY_FILE_BYTES) {
      setError("Recovery file is too large.");
      return;
    }
    void file.text().then(
      (text) => {
        try {
          const match = parseRecoveryFile(text).find((c) => normPubkey(c.envelope.pubkey) === wanted);
          if (!match) {
            setError(
              `This recovery file is for a different identity. Choose the file named opendeal-identity-${wanted.slice(0, 8)}.json.`,
            );
            return;
          }
          setFileEnvelope(match.envelope);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Invalid recovery file.");
        }
      },
      () => setError("Could not read the file."),
    );
  }

  async function onUnlock() {
    if (!envelope || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await unlockIdentity(envelope, passphrase, () => {
        void queryClient.cancelQueries();
        queryClient.clear();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlock.");
    } finally {
      running.current = false;
      setBusy(false);
      setPassphrase("");
    }
  }

  return (
    <section
      aria-label="Unlock signing key"
      className="flex flex-col gap-3 rounded border border-[var(--warn)] bg-[var(--warn)]/10 p-4 text-sm"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Unlock your signing key to act on this deal</h2>
        <p className="text-xs text-[var(--ink-muted)]">
          You are signed in as {wanted.slice(0, 8)}…, but this tab has no signing key (keys are kept
          only in memory and are cleared when the page reloads). Signing buttons stay disabled until
          you unlock.
        </p>
      </div>
      {deviceMatch && !fileEnvelope ? (
        <p className="text-xs">Using the encrypted copy saved on this device.</p>
      ) : (
        <label className="flex flex-col gap-1 text-xs">
          Recovery file (opendeal-identity-{wanted.slice(0, 8)}.json)
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {envelope ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label="Passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && passphrase.length >= MIN_PASSPHRASE_LENGTH) void onUnlock();
            }}
          />
          <button
            type="button"
            disabled={busy || passphrase.length < MIN_PASSPHRASE_LENGTH}
            onClick={() => void onUnlock()}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
