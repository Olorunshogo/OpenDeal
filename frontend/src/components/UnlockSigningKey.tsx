"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Card,
  PasswordInput,
  UploadField,
} from "@/components/ui";
import { normPubkey } from "@/lib/crypto";
import { useDeviceIdentity } from "@/lib/device-identity";
import { unlockIdentity } from "@/lib/identity-session";
import {
  MAX_IDENTITY_FILE_BYTES,
  parseRecoveryFile,
  type EncryptedEnvelope,
} from "@/lib/identity-vault";
import { errorMessage } from "@/lib/server-errors";
import { unlockSchema, type UnlockValues } from "@/schemas/identity";

/**
 * Shown where signing is needed but this tab holds no signing key (for example after a reload).
 * Unlocks the SAME identity in place, from this device's encrypted copy or the recovery file,
 * so the user never leaves the page. A file for a different identity is refused before decrypting.
 */
export function UnlockSigningKey({ pubkey }: { pubkey: string }) {
  const queryClient = useQueryClient();
  const deviceIdentity = useDeviceIdentity();
  const running = useRef<boolean>(false);
  const [fileEnvelope, setFileEnvelope] = useState<EncryptedEnvelope | null>(
    null
  );
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const [error, setError] = useState<string>("");
  const form = useForm<UnlockValues>({
    resolver: zodResolver(unlockSchema),
    defaultValues: { passphrase: "" },
  });

  const wanted: string = normPubkey(pubkey);
  const deviceMatch =
    deviceIdentity && normPubkey(deviceIdentity.pubkey) === wanted
      ? deviceIdentity
      : null;
  const envelope = fileEnvelope ?? deviceMatch;

  function onFile(file: File | null) {
    setError("");
    setFileEnvelope(null);
    setChosenFile(file);
    if (!file) return;
    if (file.size > MAX_IDENTITY_FILE_BYTES) {
      setError("Recovery file is too large.");
      return;
    }
    void file.text().then(
      (text) => {
        try {
          const match = parseRecoveryFile(text).find(
            (c) => normPubkey(c.envelope.pubkey) === wanted
          );
          if (!match) {
            setError(
              `This recovery file is for a different identity. Choose the file named opendeal-identity-${wanted.slice(0, 8)}.json.`
            );
            return;
          }
          setFileEnvelope(match.envelope);
        } catch (e) {
          setError(errorMessage(e, "Invalid recovery file."));
        }
      },
      () => setError("Could not read the file.")
    );
  }

  const onUnlock = (event: FormEvent<HTMLFormElement>): Promise<void> =>
    form.handleSubmit(async (values: UnlockValues) => {
      if (!envelope || running.current) return;
      running.current = true;
      setError("");
      try {
        await unlockIdentity(envelope, values.passphrase, () => {
          void queryClient.cancelQueries();
          queryClient.clear();
        });
      } catch (e) {
        form.setError("passphrase", {
          type: "server",
          message: errorMessage(e, "Could not unlock."),
        });
      } finally {
        running.current = false;
        form.reset({ passphrase: "" });
      }
    })(event);

  const busy: boolean = form.formState.isSubmitting;

  return (
    <Card
      aria-label="Unlock signing key"
      role="region"
      className="border-warn/40 bg-warn/[0.06]"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-warn/40 bg-warn/10 text-warn">
          <LockKeyhole aria-hidden="true" className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-semibold text-ink">
            Unlock your signing key to act on this deal
          </h2>
          <p className="text-sm text-ink-muted">
            You are signed in as {wanted.slice(0, 8)}…, but this tab has no
            signing key (keys are kept only in memory and are cleared when the
            page reloads). Signing buttons stay disabled until you unlock.
          </p>
        </div>
      </div>
      {deviceMatch && !fileEnvelope ? (
        <Alert tone="info">
          Using the encrypted copy saved on this device.
        </Alert>
      ) : (
        <UploadField
          label={`Recovery file (opendeal-identity-${wanted.slice(0, 8)}.json)`}
          accept="application/json,.json"
          file={chosenFile}
          onFileChange={onFile}
          disabled={busy}
        />
      )}
      {envelope ? (
        <form onSubmit={onUnlock} className="flex flex-col gap-3" noValidate>
          <Controller
            control={form.control}
            name="passphrase"
            render={({ field, fieldState }) => (
              <PasswordInput
                label="Passphrase"
                autoComplete="current-password"
                error={fieldState.error?.message}
                {...field}
              />
            )}
          />
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Unlocking…"
            className="w-full sm:w-fit"
          >
            Unlock
          </Button>
        </form>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Card>
  );
}
