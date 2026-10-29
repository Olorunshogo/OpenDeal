"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { Input } from "@/components/ui/Input";
import { nostrLogin, requestNostrChallenge } from "@/lib/api";
import {
  forgetDeviceIdentity,
  saveDeviceIdentity,
  useDeviceIdentity,
} from "@/lib/device-identity";
import { createAndSignIn, unlockIdentity } from "@/lib/identity-session";
import {
  identityFileFor,
  MAX_IDENTITY_FILE_BYTES,
  MIN_PASSPHRASE_LENGTH,
  parseRecoveryFile,
  type IdentityFile,
  type RestoreCandidate,
} from "@/lib/identity-vault";
import { safeNextPath } from "@/lib/navigation";
import { hasNip07, signLoginEventWithExtension } from "@/lib/nostr";
import { clearSession, saveSession, useHasSigningCapability, useSession } from "@/lib/session";

const card = "flex flex-col gap-3 rounded border border-[var(--line)] p-4";
const primary =
  "w-full rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50 sm:w-fit";
const secondary = "w-full rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40 sm:w-fit";


function downloadIdentityFile(file: IdentityFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `opendeal-identity-${file.identity.pubkey.slice(0, 8)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OnboardingClient() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const client = useQueryClient();
  const session = useSession();
  const hasKey = useHasSigningCapability(session?.pubkey);
  const deviceIdentity = useDeviceIdentity();
  const running = useRef(false);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastFile, setLastFile] = useState<IdentityFile | null>(null);

  const [createPass, setCreatePass] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");
  const [createRemember, setCreateRemember] = useState(false);

  const [candidates, setCandidates] = useState<RestoreCandidate[]>([]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [restorePass, setRestorePass] = useState("");
  const [restoreRemember, setRestoreRemember] = useState(false);

  const [devicePass, setDevicePass] = useState("");

  const clearPrivateQueries = () => {
    void client.cancelQueries();
    client.clear();
  };

  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Identity operation failed.");
    } finally {
      running.current = false;
      setBusy(false);
      setCreatePass("");
      setCreateConfirm("");
      setRestorePass("");
      setDevicePass("");
    }
  }

  const signedIn = Boolean(session?.token);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 animate-rise">
        <NetworkBanner />
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Identity</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            Sign in to OpenDeal
          </h1>
          <p className="text-[var(--ink-muted)]">
            Your identity is a key that only you hold. OpenDeal never receives it: you sign in
            by signing a one-time challenge, and your key signs agreements and settlements in
            this browser.
          </p>
        </div>

        {signedIn && session ? (
          <section className={`${card} border-[var(--ok)]`} aria-label="Active identity">
            <p className="text-sm">
              Signed in as{" "}
              <span className="break-all font-mono text-xs">{session.pubkey}</span>
            </p>
            <p className={`text-xs ${hasKey ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>
              {hasKey
                ? "Signing key unlocked in memory for this tab."
                : "No signing key in this tab: you can browse, but signing agreements needs an identity unlocked here."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button type="button" className={primary} onClick={() => router.push(next)}>
                Continue
              </button>
              {lastFile ? (
                <button type="button" className={secondary} onClick={() => downloadIdentityFile(lastFile)}>
                  Download recovery file again
                </button>
              ) : null}
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  clearSession();
                  clearPrivateQueries();
                  setMessage("Signed out. Your recovery file and any device copy are unchanged.");
                }}
              >
                Sign out
              </button>
            </div>
          </section>
        ) : null}

        {deviceIdentity && !(signedIn && hasKey && session?.pubkey === deviceIdentity.pubkey) ? (
          <section className={card} aria-label="Unlock on this device">
            <h2 className="text-xl">Unlock your identity on this device</h2>
            <p className="break-all font-mono text-xs">{deviceIdentity.pubkey}</p>
            <Input
              label="Recovery passphrase"
              type="password"
              autoComplete="current-password"
              value={devicePass}
              onChange={(e) => setDevicePass(e.target.value)}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                className={primary}
                disabled={busy || devicePass.length < MIN_PASSPHRASE_LENGTH}
                onClick={() =>
                  void run(async () => {
                    await unlockIdentity(deviceIdentity, devicePass, clearPrivateQueries);
                    setLastFile(identityFileFor(deviceIdentity));
                    setMessage("Unlocked and signed in.");
                  })
                }
              >
                {busy ? "Unlocking…" : "Unlock and sign in"}
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove the encrypted copy from this browser? You will need your recovery file to sign in again.",
                    )
                  ) {
                    forgetDeviceIdentity();
                    setMessage("Removed from this device.");
                  }
                }}
              >
                Forget on this device
              </button>
            </div>
          </section>
        ) : null}

        <section className={card} aria-label="Create a new identity">
          <h2 className="text-xl">Create a new identity</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            A new key is generated in this browser and encrypted with your passphrase. The
            encrypted recovery file downloads automatically. Keep the file and the passphrase:
            together they are the only way to recover this identity.
          </p>
          <Input
            label={`Recovery passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters)`}
            type="password"
            autoComplete="new-password"
            value={createPass}
            onChange={(e) => setCreatePass(e.target.value)}
          />
          <Input
            label="Confirm passphrase"
            type="password"
            autoComplete="new-password"
            value={createConfirm}
            onChange={(e) => setCreateConfirm(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={createRemember} onChange={(e) => setCreateRemember(e.target.checked)} />
            Also keep the encrypted identity on this device (still needs the passphrase to unlock).
          </label>
          <button
            type="button"
            className={primary}
            disabled={busy || createPass.length < MIN_PASSPHRASE_LENGTH || createPass !== createConfirm}
            onClick={() =>
              void run(async () => {
                const file = await createAndSignIn(createPass, clearPrivateQueries);
                downloadIdentityFile(file);
                if (createRemember) saveDeviceIdentity(file.identity);
                setLastFile(file);
                setMessage("Identity created, recovery file downloaded, and signed in.");
              })
            }
          >
            {busy ? "Creating…" : "Create identity"}
          </button>
          {createConfirm && createPass !== createConfirm ? (
            <p className="text-xs text-[var(--danger)]">Passphrases do not match.</p>
          ) : null}
        </section>

        <section className={card} aria-label="Restore from a recovery file">
          <h2 className="text-xl">Restore from a recovery file</h2>
          <label className="flex flex-col gap-1 text-sm">
            Recovery file
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                setCandidates([]);
                setError("");
                if (!file) return;
                if (file.size > MAX_IDENTITY_FILE_BYTES) {
                  setError("Recovery file is too large.");
                  return;
                }
                void file.text().then(
                  (text) => {
                    try {
                      setCandidates(parseRecoveryFile(text));
                      setCandidateIndex(0);
                    } catch (parseError) {
                      setError(parseError instanceof Error ? parseError.message : "Invalid recovery file.");
                    }
                  },
                  () => setError("Could not read the file."),
                );
              }}
            />
          </label>
          {candidates.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              This file holds several identities. Choose yours:
              <select
                className="rounded border border-[var(--line)] bg-[var(--bg-deep)] p-2"
                value={candidateIndex}
                onChange={(e) => setCandidateIndex(Number(e.target.value))}
              >
                {candidates.map((c, i) => (
                  <option key={c.envelope.pubkey} value={i}>
                    {c.label} · {c.envelope.pubkey.slice(0, 12)}…
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {candidates.length === 1 ? (
            <p className="break-all font-mono text-xs">{candidates[0].envelope.pubkey}</p>
          ) : null}
          {candidates.length ? (
            <>
              <Input
                label="Recovery passphrase"
                type="password"
                autoComplete="current-password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
              />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={restoreRemember} onChange={(e) => setRestoreRemember(e.target.checked)} />
                Keep the encrypted identity on this device.
              </label>
              <button
                type="button"
                className={primary}
                disabled={busy || restorePass.length < MIN_PASSPHRASE_LENGTH}
                onClick={() =>
                  void run(async () => {
                    const chosen = candidates[candidateIndex];
                    const envelope = await unlockIdentity(chosen.envelope, restorePass, clearPrivateQueries);
                    if (restoreRemember) saveDeviceIdentity(envelope);
                    const file = identityFileFor(envelope);
                    setLastFile(file);
                    setCandidates([]);
                    setMessage(
                      chosen.envelope.legacyRole
                        ? "Restored and signed in. Download the recovery file again to get a file that holds only this identity."
                        : "Restored and signed in.",
                    );
                  })
                }
              >
                {busy ? "Restoring…" : "Restore and sign in"}
              </button>
            </>
          ) : null}
        </section>

        <section className={card} aria-label="Nostr extension">
          <h2 className="text-xl">Use a Nostr extension</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Sign in with a NIP-07 extension (Alby, nos2x). The extension keeps the key, so this
            tab cannot sign OpenDeal agreements or settlement PSBTs with it.
          </p>
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!hasNip07()) throw new Error("No Nostr extension detected in this browser.");
                const pubkey = await window.nostr!.getPublicKey();
                const { nonce } = await requestNostrChallenge(pubkey);
                const auth = await nostrLogin(await signLoginEventWithExtension(nonce));
                clearSession();
                clearPrivateQueries();
                saveSession({ token: auth.token, pubkey: auth.pubkey, roleLabel: "seller" });
                setMessage("Signed in with your Nostr extension.");
              })
            }
          >
            Connect Nostr extension
          </button>
        </section>

        <p className="text-sm text-[var(--ink-muted)]">
          Want to mediate disputes? After signing in, apply at{" "}
          <Link href="/mediator" className="underline">
            the mediator desk
          </Link>
          . An administrator approves mediators.
        </p>

        {busy ? <p role="status">Working…</p> : null}
        {message ? (
          <p role="status" className="text-sm text-[var(--ok)]">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
