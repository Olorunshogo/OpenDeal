"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  nostrLogin,
  registerWebhook,
  requestNostrChallenge,
  type WebhookEndpoint,
} from "@/lib/api";
import { normPubkey, pubkeyFromSecret } from "@/lib/crypto";
import { signInWithSecret as signInWithKey } from "@/lib/identity-session";
import { hasNip07, signLoginEventWithExtension } from "@/lib/nostr";
import {
  clearSession,
  getSigningCapability,
  loadSession,
  saveSession,
  setSigningCapability,
  updateSessionRoleLabel,
  useHasSigningCapability,
  useSession,
  type Session,
} from "@/lib/session";
import { Input } from "@/components/ui/Input";

export function SessionBar() {
  const session: Session | null = useSession();
  const hasSigningKey: boolean = useHasSigningCapability(session?.pubkey);
  const queryClient = useQueryClient();
  const [signingSecret, setSigningSecret] = useState<string>("");
  const [roleLabel] = useState<string>("seller");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showSigningKeyForm, setShowSigningKeyForm] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showWebhooks, setShowWebhooks] = useState<boolean>(false);
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [webhookBusy, setWebhookBusy] = useState<boolean>(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookResult, setWebhookResult] = useState<WebhookEndpoint | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function onCopyPubkey() {
    if (!session) {
      return;
    }
    try {
      await navigator.clipboard.writeText(session.pubkey);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }

  function persist(next: Session) {
    saveSession(next);
    setError(null);
  }

  async function onConnectExtension() {
    setBusy(true);
    setError(null);
    try {
      if (!hasNip07()) {
        throw new Error("No Nostr extension detected. Create or restore an identity instead.");
      }
      const pk = await window.nostr!.getPublicKey();
      const { nonce } = await requestNostrChallenge(pk);
      const event = await signLoginEventWithExtension(nonce);
      const auth = await nostrLogin(event);
      persist({
        token: auth.token,
        pubkey: auth.pubkey,
        roleLabel,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nostr login failed");
    } finally {
      setBusy(false);
    }
  }

  // Proves key possession with a signed Nostr challenge; there is no pubkey-only sign-in.
  async function signInWithSecret(secret: string, role: string) {
    setBusy(true);
    setError(null);
    try {
      await signInWithKey(
        secret,
        () => {
          void queryClient.cancelQueries();
          queryClient.clear();
        },
        role,
      );
      setSigningSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "login with secret failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAttachSigningKey() {
    const active = loadSession();
    const secret = signingSecret.trim();
    if (!active || !secret) {
      setError("Enter the local signing key for the active identity.");
      return;
    }
    try {
      if (normPubkey(pubkeyFromSecret(secret)) !== normPubkey(active.pubkey)) {
        throw new Error("The supplied signing key does not match the active public identity.");
      }
      if (!active.token) {
        await signInWithSecret(secret, active.roleLabel);
      } else {
        setSigningCapability(active.pubkey, secret);
        setSigningSecret("");
        setShowSigningKeyForm(false);
        setError(null);
      }
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : "Could not attach signing key.");
    }
  }

  function onClear() {
    clearSession();
    queryClient.clear();
    setError(null);
    setSigningSecret("");
  }

  async function onRegisterWebhook() {
    setWebhookError(null);
    const current = loadSession();
    if (!current?.token) {
      setWebhookError("Sign in first.");
      return;
    }
    setWebhookBusy(true);
    try {
      const endpoint = await registerWebhook(current.token, webhookUrl.trim());
      setWebhookResult(endpoint);
      setWebhookUrl("");
    } catch (err) {
      setWebhookError(err instanceof Error ? err.message : "webhook registration failed");
    } finally {
      setWebhookBusy(false);
    }
  }

  const linkButtonClass: string =
    "underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]";

  if (session && !session.token) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3 text-sm">
        <p className="text-[var(--ink)]">
          Your sign-in for {session.roleLabel} {session.pubkey.slice(0, 8)}…{session.pubkey.slice(-6)}{" "}
          expired.
          {hasSigningKey
            ? " Your signing key is only in memory; it will be lost on refresh."
            : " Sign in again with the same key to keep acting on your deals."}
        </p>
        <RoleLabelSelector value={session.roleLabel} onChange={updateSessionRoleLabel} disabled={busy} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {hasSigningKey ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const secret = getSigningCapability(session.pubkey);
                if (secret) {
                  void signInWithSecret(secret, session.roleLabel);
                }
              }}
              className="rounded bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--bg-deep)] disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in again"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onConnectExtension}
              className="rounded bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--bg-deep)] disabled:opacity-50"
            >
              {busy ? "Working…" : "Reconnect Nostr extension"}
            </button>
          )}
          <Link href="/onboarding" className={`w-fit ${linkButtonClass}`}>
            Unlock from recovery file or this device
          </Link>
          <button type="button" onClick={onClear} className={`w-fit ${linkButtonClass}`}>
            Sign out
          </button>
        </div>
        {!hasSigningKey ? (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={() => setShowSigningKeyForm((visible) => !visible)}
              className={linkButtonClass}
            >
              {showSigningKeyForm ? "Hide key entry" : "Reconnect with local signing key"}
            </button>
            {showSigningKeyForm ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Input
                  label="Signing key (32-byte hex, memory only)"
                  mono
                  value={signingSecret}
                  onChange={(event) => setSigningSecret(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || !signingSecret.trim()}
                  onClick={() => void onAttachSigningKey()}
                  className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
                >
                  {busy ? "Signing in…" : "Use this key"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  if (session) {
    return (
      <div className="flex flex-col gap-2 text-sm text-[var(--ink-muted)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="network-badge rounded border border-[var(--line)] px-2 py-1 text-[var(--accent-soft)]">
            regtest experimental
          </span>
          <span className="break-all">
            Test label · {session.roleLabel}: {session.pubkey.slice(0, 8)}…{session.pubkey.slice(-6)}
          </span>
          <button
            type="button"
            onClick={onCopyPubkey}
            title={session.pubkey}
            className={linkButtonClass}
          >
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy pubkey"}
          </button>
          {hasSigningKey ? (
            <span className="text-[10px] text-[var(--ok)]">signing key in memory</span>
          ) : (
            <span className="text-[10px] text-[var(--danger)]">
              no signing key (needed for agreement sign)
            </span>
          )}
          <button type="button" onClick={onClear} className={linkButtonClass}>
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setShowWebhooks((v) => !v)}
            className={linkButtonClass}
          >
            {showWebhooks ? "Hide webhooks" : "Webhooks"}
          </button>
        </div>
        <RoleLabelSelector value={session.roleLabel} onChange={updateSessionRoleLabel} disabled={busy} />
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {!hasSigningKey && !showSigningKeyForm ? (
          <button
            type="button"
            onClick={() => setShowSigningKeyForm(true)}
            className={`w-fit text-xs ${linkButtonClass}`}
          >
            Add local signing key
          </button>
        ) : null}
        {!hasSigningKey && showSigningKeyForm ? (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3 sm:flex-row sm:items-end">
            <Input
              label="Signing key (32-byte hex, memory only)"
              mono
              value={signingSecret}
              onChange={(event) => setSigningSecret(event.target.value)}
            />
            <button
              type="button"
              disabled={busy || !signingSecret.trim()}
              onClick={() => void onAttachSigningKey()}
              className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
            >
              Use this key
            </button>
          </div>
        ) : null}
        {showWebhooks ? (
          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
            <p className="text-xs">
              Register an HTTPS endpoint to receive deal event notifications for deals you are a
              party to. The signing secret is shown once, at creation.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                label="Webhook URL"
                hideLabel
                mono
                fieldClassName="min-w-0 flex-1"
                placeholder="https://example.com/webhooks/opendeal"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <button
                type="button"
                disabled={webhookBusy || !webhookUrl.trim()}
                onClick={onRegisterWebhook}
                className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
              >
                {webhookBusy ? "Registering…" : "Register webhook"}
              </button>
            </div>
            {webhookError ? <p className="text-sm text-[var(--danger)]">{webhookError}</p> : null}
            {webhookResult ? (
              <div className="flex flex-col gap-1 rounded border border-[var(--line)] p-2 text-xs">
                <p className="break-all">
                  Endpoint <span className="font-mono">{webhookResult.id}</span> registered for{" "}
                  {webhookResult.url}
                </p>
                <p className="break-all font-mono text-[var(--ok)]">
                  secret: {webhookResult.secret}
                </p>
                <p className="text-[var(--ink-muted)]">
                  Store this now. It is not shown again. Verify the{" "}
                  <span className="font-mono">X-OpenDeal-Signature</span> header (HMAC-SHA256 of
                  the raw body) on deliveries.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-lift)]/60 p-3 text-sm">
      <p className="text-[var(--ink-muted)]">
        Not signed in. Create an identity or restore one from your recovery file. Your key stays
        in this browser; OpenDeal only sees a signed one-time challenge.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Link
          href="/onboarding"
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-center font-medium text-[var(--bg-deep)]"
        >
          Sign in or create identity
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={onConnectExtension}
          className="rounded border border-[var(--line)] px-3 py-1.5 hover:border-[var(--accent)] disabled:opacity-50"
        >
          {busy ? "Working…" : "Connect Nostr extension"}
        </button>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-fit text-xs underline decoration-[var(--line)] underline-offset-4"
        >
          {showAdvanced ? "Hide advanced" : "Advanced"}
        </button>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {showAdvanced ? (
        <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3 sm:flex-row sm:items-end">
          <Input
            label="Raw signing key (32-byte hex, memory only)"
            mono
            fieldClassName="min-w-0 flex-1"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !signingSecret.trim()}
            onClick={() => signInWithSecret(signingSecret.trim(), roleLabel)}
            className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
          >
            Sign in with this key
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RoleLabelSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
      <label className="flex flex-wrap items-center gap-2">
        <span>Local test label</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="rounded border border-[var(--line)] bg-[var(--bg-deep)] px-2 py-1.5"
        >
          <option value="seller">seller</option>
          <option value="buyer">buyer</option>
          <option value="mediator">mediator</option>
        </select>
      </label>
      <p>
        Label only. Your public key and the deal determine permissions. Mediator dispute listing
        also requires the API allowlist.
      </p>
    </div>
  );
}
