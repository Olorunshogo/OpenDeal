"use client";

import { useState } from "react";
import {
  devSession,
  nostrLogin,
  requestNostrChallenge,
} from "@/lib/api";
import { generateDemoIdentity, pubkeyFromSecret } from "@/lib/crypto";
import {
  hasNip07,
  signLoginEventWithExtension,
  signLoginEventWithSecret,
} from "@/lib/nostr";
import { clearSession, loadSession, saveSession, type Session } from "@/lib/session";
import { Input } from "@/components/ui/Input";

export function SessionBar() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [token, setToken] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [roleLabel, setRoleLabel] = useState("seller");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function persist(next: Session) {
    saveSession(next);
    setSession(next);
    setError(null);
  }

  async function onCreateDemoIdentity() {
    setBusy(true);
    setError(null);
    try {
      const id = generateDemoIdentity();
      const auth = await devSession(id.pubkeyHex);
      persist({
        token: auth.token,
        pubkey: auth.pubkey,
        roleLabel,
        signingSecret: id.secretHex,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "demo identity failed");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectExtension() {
    setBusy(true);
    setError(null);
    try {
      if (!hasNip07()) {
        throw new Error("No Nostr extension detected. Use “Create regtest identity” or paste a JWT.");
      }
      const pk = await window.nostr!.getPublicKey();
      const { nonce } = await requestNostrChallenge(pk);
      const event = await signLoginEventWithExtension(nonce);
      const auth = await nostrLogin(event);
      persist({
        token: auth.token,
        pubkey: auth.pubkey,
        roleLabel,
        signingSecret: loadSession()?.signingSecret,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nostr login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLoginWithSecret() {
    setBusy(true);
    setError(null);
    try {
      const secret = signingSecret.trim();
      const compressed = pubkeyFromSecret(secret);
      const auth = await devSession(compressed);
      persist({
        token: auth.token,
        pubkey: auth.pubkey,
        roleLabel,
        signingSecret: secret,
      });
    } catch (err) {
      try {
        const secret = signingSecret.trim();
        const compressed = pubkeyFromSecret(secret);
        const xonly = compressed.slice(2);
        const { nonce } = await requestNostrChallenge(xonly);
        const event = signLoginEventWithSecret(secret, nonce);
        const auth = await nostrLogin(event);
        persist({
          token: auth.token,
          pubkey: auth.pubkey,
          roleLabel,
          signingSecret: secret,
        });
      } catch (inner) {
        setError(inner instanceof Error ? inner.message : "login with secret failed");
      }
    } finally {
      setBusy(false);
    }
  }

  function onSavePaste() {
    const next: Session = {
      token: token.trim(),
      pubkey: pubkey.trim(),
      roleLabel,
      signingSecret: signingSecret.trim() || undefined,
    };
    persist(next);
  }

  function onClear() {
    clearSession();
    setSession(null);
    setToken("");
    setPubkey("");
    setSigningSecret("");
  }

  if (session) {
    return (
      <div className="flex flex-col gap-2 text-sm text-[var(--ink-muted)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="network-badge rounded border border-[var(--line)] px-2 py-1 text-[var(--accent-soft)]">
            regtest experimental
          </span>
          <span>
            {session.roleLabel}: {session.pubkey.slice(0, 8)}…{session.pubkey.slice(-6)}
          </span>
          {session.signingSecret ? (
            <span className="text-[10px] text-[var(--ok)]">signing key local</span>
          ) : (
            <span className="text-[10px] text-[var(--danger)]">
              no signing key (needed for agreement sign)
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            className="underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--bg-lift)]/60 p-3 text-sm">
      <p className="text-[var(--ink-muted)]">
        Sign in with a Nostr extension, or create a local regtest identity (compressed key + JWT).
        Agreement signatures use a local secp256k1 secret — never uploaded.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConnectExtension}
          className="rounded bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--bg-deep)] disabled:opacity-50"
        >
          {busy ? "Working…" : "Connect Nostr extension"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateDemoIdentity}
          className="rounded border border-[var(--line)] px-3 py-1.5 hover:border-[var(--accent)] disabled:opacity-50"
        >
          Create regtest identity
        </button>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs underline decoration-[var(--line)] underline-offset-4"
        >
          {showAdvanced ? "Hide advanced" : "Advanced"}
        </button>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {showAdvanced ? (
        <div className="grid gap-2 border-t border-[var(--line)] pt-3 md:grid-cols-2">
          <Input
            label="Signing secret (32-byte hex, stays in browser)"
            hideLabel
            mono
            fieldClassName="md:col-span-2"
            placeholder="Signing secret (32-byte hex, stays in browser)"
            value={signingSecret}
            onChange={(e) => setSigningSecret(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !signingSecret.trim()}
            onClick={onLoginWithSecret}
            className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-50"
          >
            Login with signing secret
          </button>
          <select
            className="rounded border border-[var(--line)] bg-[var(--bg-deep)] px-2 py-1.5"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
          >
            <option value="seller">seller</option>
            <option value="buyer">buyer</option>
            <option value="mediator">mediator</option>
          </select>
          <Input
            label="Paste JWT (fallback)"
            hideLabel
            fieldClassName="md:col-span-2"
            placeholder="Paste JWT (fallback)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Input
            label="Pubkey hex for pasted JWT"
            hideLabel
            fieldClassName="md:col-span-2"
            placeholder="Pubkey hex for pasted JWT"
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
          />
          <button
            type="button"
            onClick={onSavePaste}
            className="w-fit rounded border border-[var(--line)] px-3 py-1.5"
          >
            Save pasted session
          </button>
        </div>
      ) : null}
    </div>
  );
}
