"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Webhook } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  HashValue,
  Input,
  PasswordInput,
} from "@/components/ui";
import { nostrLogin, registerWebhook, requestNostrChallenge, type WebhookEndpoint } from "@/lib/api";
import { normPubkey, pubkeyFromSecret } from "@/lib/crypto";
import { signInWithSecret as signInWithKey } from "@/lib/identity-session";
import { hasNip07, signLoginEventWithExtension } from "@/lib/nostr";
import { errorMessage } from "@/lib/server-errors";
import {
  clearSession,
  getSigningCapability,
  loadSession,
  saveSession,
  setSigningCapability,
  useHasSigningCapability,
  useSession,
  type Session,
} from "@/lib/session";
import { webhookSchema, type WebhookValues } from "@/schemas/webhook";

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
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookResult, setWebhookResult] = useState<WebhookEndpoint | null>(null);
  const webhookForm = useForm<WebhookValues>({
    resolver: zodResolver(webhookSchema),
    defaultValues: { url: "" },
  });

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
      persist({ token: auth.token, pubkey: auth.pubkey, roleLabel });
    } catch (err) {
      setError(errorMessage(err, "Nostr login failed"));
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
      setError(errorMessage(err, "login with secret failed"));
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
      setError(errorMessage(keyError, "Could not attach signing key."));
    }
  }

  function onClear() {
    clearSession();
    queryClient.clear();
    setError(null);
    setSigningSecret("");
  }

  const onRegisterWebhook = webhookForm.handleSubmit(async (values: WebhookValues) => {
    setWebhookError(null);
    const current = loadSession();
    if (!current?.token) {
      setWebhookError("Sign in first.");
      return;
    }
    try {
      const endpoint = await registerWebhook(current.token, values.url);
      setWebhookResult(endpoint);
      webhookForm.reset({ url: "" });
    } catch (err) {
      setWebhookError(errorMessage(err, "webhook registration failed"));
    }
  });

  const signingKeyForm = (label: string): React.JSX.Element => (
    <div className="flex flex-col gap-3">
      <PasswordInput
        label={label}
        mono
        autoComplete="off"
        value={signingSecret}
        onChange={(event) => setSigningSecret(event.target.value)}
      />
      <Button
        variant="secondary"
        size="sm"
        className="w-fit"
        loading={busy}
        disabled={!signingSecret.trim()}
        onClick={() => void onAttachSigningKey()}
      >
        Use this key
      </Button>
    </div>
  );

  if (session && !session.token) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-warn/40 bg-warn/[0.06] p-4 text-sm">
        <p className="text-ink">
          Your sign-in for {session.pubkey.slice(0, 8)}…{session.pubkey.slice(-6)} expired.
          {hasSigningKey
            ? " Your signing key is only in memory; it will be lost on refresh."
            : " Sign in again with the same key to keep acting on your deals."}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {hasSigningKey ? (
            <Button
              size="sm"
              loading={busy}
              loadingLabel="Signing in…"
              onClick={() => {
                const secret = getSigningCapability(session.pubkey);
                if (secret) {
                  void signInWithSecret(secret, session.roleLabel);
                }
              }}
            >
              Sign in again
            </Button>
          ) : (
            <Button size="sm" loading={busy} onClick={onConnectExtension}>
              Reconnect Nostr extension
            </Button>
          )}
          <ButtonLink href="/onboarding" variant="link" size="sm">
            Unlock from recovery file or this device
          </ButtonLink>
          <Button variant="link" size="sm" onClick={onClear}>
            Sign out
          </Button>
        </div>
        {!hasSigningKey ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <Button
              variant="link"
              size="sm"
              className="w-fit"
              onClick={() => setShowSigningKeyForm((visible) => !visible)}
            >
              {showSigningKeyForm ? "Hide key entry" : "Reconnect with local signing key"}
            </Button>
            {showSigningKeyForm ? signingKeyForm("Signing key (32-byte hex, memory only)") : null}
          </div>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    );
  }

  if (session) {
    return (
      <div className="flex flex-col gap-3 text-sm text-ink-muted">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone="brand" dot className="network-badge">
            regtest experimental
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            Signed in ·
            <HashValue value={session.pubkey} copyable={false} />
          </span>
          <CopyButton value={session.pubkey} label="Copy pubkey" variant="ghost" />
          <Badge tone={hasSigningKey ? "ok" : "danger"}>
            {hasSigningKey ? "signing key in memory" : "no signing key (needed for agreement sign)"}
          </Badge>
          <Button variant="link" size="sm" onClick={onClear}>
            Sign out
          </Button>
          <Button
            variant="link"
            size="sm"
            leading={<Webhook className="size-3.5" />}
            onClick={() => setShowWebhooks((visible) => !visible)}
          >
            {showWebhooks ? "Hide webhooks" : "Webhooks"}
          </Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!hasSigningKey && !showSigningKeyForm ? (
          <Button variant="link" size="sm" className="w-fit text-xs" onClick={() => setShowSigningKeyForm(true)}>
            Add local signing key
          </Button>
        ) : null}
        {!hasSigningKey && showSigningKeyForm ? (
          <div className="border-t border-line pt-3">{signingKeyForm("Signing key (32-byte hex, memory only)")}</div>
        ) : null}
        {showWebhooks ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <p className="text-xs">
              Register an HTTPS endpoint to receive deal event notifications for deals you are a party to. The
              signing secret is shown once, at creation.
            </p>
            <form onSubmit={onRegisterWebhook} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
              <Input
                label="Webhook URL"
                hideLabel
                mono
                fieldClassName="min-w-0 flex-1"
                placeholder="https://example.com/webhooks/opendeal"
                error={webhookForm.formState.errors.url?.message}
                {...webhookForm.register("url")}
              />
              <Button
                type="submit"
                variant="secondary"
                loading={webhookForm.formState.isSubmitting}
                loadingLabel="Registering…"
              >
                Register webhook
              </Button>
            </form>
            {webhookError ? <Alert tone="danger">{webhookError}</Alert> : null}
            {webhookResult ? (
              <Alert tone="ok" title={`Endpoint ${webhookResult.id} registered for ${webhookResult.url}`}>
                <span className="flex flex-col gap-2">
                  <HashValue value={webhookResult.secret} full />
                  <span>
                    Store this now. It is not shown again. Verify the{" "}
                    <span className="font-mono text-ink">X-OpenDeal-Signature</span> header (HMAC-SHA256 of the raw
                    body) on deliveries.
                  </span>
                </span>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-glass p-4 text-sm backdrop-blur-md">
      <p className="text-ink-muted">
        Not signed in. Create an identity or restore one from your recovery file. Your key stays in this browser;
        OpenDeal only sees a signed one-time challenge.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <ButtonLink href="/onboarding" size="sm">
          Sign in or create identity
        </ButtonLink>
        <Button variant="secondary" size="sm" loading={busy} onClick={onConnectExtension}>
          Connect Nostr extension
        </Button>
        <Button variant="link" size="sm" className="w-fit text-xs" onClick={() => setShowAdvanced((visible) => !visible)}>
          {showAdvanced ? "Hide advanced" : "Advanced"}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {showAdvanced ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <PasswordInput
            label="Raw signing key (32-byte hex, memory only)"
            mono
            autoComplete="off"
            value={signingSecret}
            onChange={(event) => setSigningSecret(event.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            loading={busy}
            disabled={!signingSecret.trim()}
            onClick={() => signInWithSecret(signingSecret.trim(), roleLabel)}
          >
            Sign in with this key
          </Button>
        </div>
      ) : null}
    </div>
  );
}
