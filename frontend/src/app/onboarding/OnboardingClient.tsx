"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { NetworkBanner } from "@/components/NetworkBanner";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  Dialog,
  HashValue,
  PasswordInput,
  Select,
  Tabs,
  UploadField,
  type SelectOption,
} from "@/components/ui";
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
import { errorMessage } from "@/lib/server-errors";
import {
  clearSession,
  saveSession,
  useHasSigningCapability,
  useSession,
  type Session,
} from "@/lib/session";
import {
  createIdentitySchema,
  restoreSchema,
  unlockSchema,
  type CreateIdentityValues,
  type RestoreValues,
  type UnlockValues,
} from "@/schemas/identity";

type IdentityTab = "create" | "restore" | "extension";

function downloadIdentityFile(file: IdentityFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `opendeal-identity-${file.identity.pubkey.slice(0, 8)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next: string = safeNextPath(searchParams.get("next"));
  // Only auto-return when a page asked for sign-in (?next=...); otherwise stay and show the result.
  const returnAfterSignIn: boolean = Boolean(searchParams.get("next"));
  const client = useQueryClient();
  const session: Session | null = useSession();
  const hasKey: boolean = useHasSigningCapability(session?.pubkey);
  const deviceIdentity = useDeviceIdentity();
  const running = useRef<boolean>(false);

  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [lastFile, setLastFile] = useState<IdentityFile | null>(null);
  const [tab, setTab] = useState<IdentityTab>("create");
  const [candidates, setCandidates] = useState<RestoreCandidate[]>([]);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [forgetOpen, setForgetOpen] = useState<boolean>(false);

  const createForm = useForm<CreateIdentityValues>({
    resolver: zodResolver(createIdentitySchema),
    defaultValues: {
      passphrase: "",
      confirmPassphrase: "",
      keepOnDevice: false,
    },
  });
  const deviceForm = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { passphrase: "" },
  });
  const restoreForm = useForm<RestoreValues>({
    resolver: zodResolver(restoreSchema),
    defaultValues: { candidateIndex: "0", passphrase: "", keepOnDevice: false },
  });

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
      setError(errorMessage(e, "Identity operation failed."));
    } finally {
      running.current = false;
      setBusy(false);
      createForm.resetField("passphrase");
      createForm.resetField("confirmPassphrase");
      restoreForm.resetField("passphrase");
      deviceForm.resetField("passphrase");
    }
  }

  function onRecoveryFile(file: File | null) {
    setRecoveryFile(file);
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
          restoreForm.setValue("candidateIndex", "0");
        } catch (parseError) {
          setError(errorMessage(parseError, "Invalid recovery file."));
        }
      },
      () => setError("Could not read the file.")
    );
  }

  const onCreate = (event: FormEvent<HTMLFormElement>): Promise<void> =>
    createForm.handleSubmit((values: CreateIdentityValues) =>
      run(async () => {
        const file = await createAndSignIn(
          values.passphrase,
          clearPrivateQueries
        );
        downloadIdentityFile(file);
        if (values.keepOnDevice) saveDeviceIdentity(file.identity);
        setLastFile(file);
        setMessage(
          "Identity created, recovery file downloaded, and signed in."
        );
      })
    )(event);

  const onUnlockDevice = (event: FormEvent<HTMLFormElement>): Promise<void> =>
    deviceForm.handleSubmit((values: UnlockValues) =>
      run(async () => {
        if (!deviceIdentity) return;
        await unlockIdentity(
          deviceIdentity,
          values.passphrase,
          clearPrivateQueries
        );
        setLastFile(identityFileFor(deviceIdentity));
        setMessage("Unlocked and signed in.");
        if (returnAfterSignIn) router.push(next);
      })
    )(event);

  const onRestore = (event: FormEvent<HTMLFormElement>): Promise<void> =>
    restoreForm.handleSubmit((values: RestoreValues) =>
      run(async () => {
        const chosen = candidates[Number(values.candidateIndex)];
        if (!chosen) return;
        const envelope = await unlockIdentity(
          chosen.envelope,
          values.passphrase,
          clearPrivateQueries
        );
        if (values.keepOnDevice) saveDeviceIdentity(envelope);
        setLastFile(identityFileFor(envelope));
        setCandidates([]);
        setRecoveryFile(null);
        setMessage(
          chosen.envelope.legacyRole
            ? "Restored and signed in. Download the recovery file again to get a file that holds only this identity."
            : "Restored and signed in."
        );
        if (returnAfterSignIn && !chosen.envelope.legacyRole) router.push(next);
      })
    )(event);

  const onConnectExtension = () =>
    void run(async () => {
      if (!hasNip07())
        throw new Error("No Nostr extension detected in this browser.");
      const pubkey = await window.nostr!.getPublicKey();
      const { nonce } = await requestNostrChallenge(pubkey);
      const auth = await nostrLogin(await signLoginEventWithExtension(nonce));
      clearSession();
      clearPrivateQueries();
      saveSession({
        token: auth.token,
        pubkey: auth.pubkey,
        roleLabel: "seller",
      });
      setMessage("Signed in with your Nostr extension.");
    });

  const signedIn: boolean = Boolean(session?.token);
  const candidateOptions: SelectOption[] = candidates.map(
    (candidate, index) => ({
      value: String(index),
      label: candidate.label,
      description: `${candidate.envelope.pubkey.slice(0, 12)}…`,
    })
  );

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 animate-rise">
        <NetworkBanner />
        <PageHeader
          eyebrow="Identity"
          title="Sign in to OpenDeal"
          description="Your identity is a key that only you hold. OpenDeal never receives it: you sign in by signing a one-time challenge, and your key signs agreements and settlements in this browser."
        />

        {message ? <Alert tone="ok">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {signedIn && session ? (
          <Card tone="brand" aria-label="Active identity" role="region">
            <CardHeader
              title="Signed in"
              action={
                <Badge tone={hasKey ? "ok" : "warn"} dot>
                  {hasKey ? "Signing key unlocked" : "Signing key locked"}
                </Badge>
              }
            />
            <HashValue value={session.pubkey} full />
            <p className="text-sm text-ink-muted">
              {hasKey
                ? "Signing key unlocked in memory for this tab."
                : "No signing key in this tab: you can browse, but signing agreements needs an identity unlocked here."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button onClick={() => router.push(next)}>Continue</Button>
              {lastFile ? (
                <Button
                  variant="secondary"
                  onClick={() => downloadIdentityFile(lastFile)}
                >
                  Download recovery file again
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  clearSession();
                  clearPrivateQueries();
                  setMessage(
                    "Signed out. Your recovery file and any device copy are unchanged."
                  );
                }}
              >
                Sign out
              </Button>
            </div>
          </Card>
        ) : null}

        {deviceIdentity &&
        !(signedIn && hasKey && session?.pubkey === deviceIdentity.pubkey) ? (
          <Card tone="violet" aria-label="Unlock on this device" role="region">
            <CardHeader
              title="Unlock your identity on this device"
              description="An encrypted copy is saved in this browser."
              action={
                <LockKeyhole
                  aria-hidden="true"
                  className="size-5 text-violet-soft"
                />
              }
            />
            <HashValue value={deviceIdentity.pubkey} full />
            <form
              onSubmit={onUnlockDevice}
              className="flex flex-col gap-3"
              noValidate
            >
              <Controller
                control={deviceForm.control}
                name="passphrase"
                render={({ field, fieldState }) => (
                  <PasswordInput
                    label="Recovery passphrase"
                    autoComplete="current-password"
                    error={fieldState.error?.message}
                    {...field}
                  />
                )}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="submit" loading={busy} loadingLabel="Unlocking…">
                  Unlock and sign in
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setForgetOpen(true)}
                >
                  Forget on this device
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card>
          <Tabs<IdentityTab>
            label="Ways to sign in"
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: "create",
                label: "Create",
                content: (
                  <form
                    onSubmit={onCreate}
                    className="flex flex-col gap-4"
                    noValidate
                  >
                    <div className="flex items-start gap-3">
                      <Sparkles
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-brand"
                      />
                      <p className="text-sm text-ink-muted">
                        A new key is generated in this browser and encrypted
                        with your passphrase. The encrypted recovery file
                        downloads automatically. Keep the file and the
                        passphrase: together they are the only way to recover
                        this identity.
                      </p>
                    </div>
                    <Controller
                      control={createForm.control}
                      name="passphrase"
                      render={({ field, fieldState }) => (
                        <PasswordInput
                          label="Recovery passphrase"
                          required
                          showStrength
                          hint={`At least ${MIN_PASSPHRASE_LENGTH} characters.`}
                          error={fieldState.error?.message}
                          {...field}
                        />
                      )}
                    />
                    <Controller
                      control={createForm.control}
                      name="confirmPassphrase"
                      render={({ field, fieldState }) => (
                        <PasswordInput
                          label="Confirm passphrase"
                          required
                          error={fieldState.error?.message}
                          {...field}
                        />
                      )}
                    />
                    <Controller
                      control={createForm.control}
                      name="keepOnDevice"
                      render={({ field }) => (
                        <Checkbox
                          label="Also keep the encrypted identity on this device"
                          description="It still needs the passphrase to unlock."
                          checked={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <Button
                      type="submit"
                      loading={busy}
                      loadingLabel="Creating…"
                      className="w-full sm:w-fit"
                    >
                      Create identity
                    </Button>
                  </form>
                ),
              },
              {
                value: "restore",
                label: "Restore",
                content: (
                  <form
                    onSubmit={onRestore}
                    className="flex flex-col gap-4"
                    noValidate
                  >
                    <UploadField
                      label="Recovery file"
                      accept="application/json,.json"
                      file={recoveryFile}
                      onFileChange={onRecoveryFile}
                      disabled={busy}
                      hint="opendeal-identity-xxxxxxxx.json"
                    />
                    {candidates.length > 1 ? (
                      <Controller
                        control={restoreForm.control}
                        name="candidateIndex"
                        render={({ field }) => (
                          <Select
                            label="This file holds several identities. Choose yours"
                            options={candidateOptions}
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                    ) : null}
                    {candidates.length === 1 ? (
                      <HashValue value={candidates[0].envelope.pubkey} full />
                    ) : null}
                    {candidates.length ? (
                      <>
                        <Controller
                          control={restoreForm.control}
                          name="passphrase"
                          render={({ field, fieldState }) => (
                            <PasswordInput
                              label="Recovery passphrase"
                              autoComplete="current-password"
                              required
                              error={fieldState.error?.message}
                              {...field}
                            />
                          )}
                        />
                        <Controller
                          control={restoreForm.control}
                          name="keepOnDevice"
                          render={({ field }) => (
                            <Checkbox
                              label="Keep the encrypted identity on this device"
                              checked={field.value}
                              onChange={field.onChange}
                            />
                          )}
                        />
                        <Button
                          type="submit"
                          loading={busy}
                          loadingLabel="Restoring…"
                          className="w-full sm:w-fit"
                        >
                          Restore and sign in
                        </Button>
                      </>
                    ) : null}
                  </form>
                ),
              },
              {
                value: "extension",
                label: "Nostr extension",
                content: (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                      <KeyRound
                        aria-hidden="true"
                        className="mt-0.5 size-5 shrink-0 text-violet-soft"
                      />
                      <p className="text-sm text-ink-muted">
                        Sign in with a NIP-07 extension (Alby, nos2x). The
                        extension keeps the key, so this tab cannot sign
                        OpenDeal agreements or settlement PSBTs with it.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      loading={busy}
                      onClick={onConnectExtension}
                      className="w-full sm:w-fit"
                    >
                      Connect Nostr extension
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </Card>

        <Alert
          tone="info"
          title="Want to mediate disputes?"
          action={
            <ButtonLink
              href="/mediator"
              size="sm"
              variant="secondary"
              leading={<ShieldCheck className="size-4" />}
            >
              Mediator desk
            </ButtonLink>
          }
        >
          After signing in, apply at the mediator desk. An administrator
          approves mediators.
        </Alert>
      </div>

      <Dialog
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        size="sm"
        title="Remove from this device?"
        description="The encrypted copy is deleted from this browser. You will need your recovery file to sign in again."
        footer={
          <>
            <Button variant="ghost" onClick={() => setForgetOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                forgetDeviceIdentity();
                setForgetOpen(false);
                setMessage("Removed from this device.");
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </AppShell>
  );
}
