"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Badge, Button, Card, CardHeader, HashValue, Input, Skeleton, type BadgeTone } from "@/components/ui";
import {
  getMyMediatorRegistration,
  registerMediator,
  registerMediatorWithEvent,
  reviewMediators,
  setMediatorStatus,
  type MediatorRegistration,
} from "@/lib/api";
import { mediatorRegistrationEvent, mediatorRegistrationSignature } from "@/lib/mediator-registration";
import { errorMessage } from "@/lib/server-errors";
import { getSigningCapability, useSession, type Session } from "@/lib/session";
import { mediatorApplicationSchema, type MediatorApplicationValues } from "@/schemas/mediator";

// === Helpers

const REGISTRATION_TONE: Record<string, BadgeTone> = {
  pending: "warn",
  approved: "ok",
  suspended: "danger",
};

// === Component

export function MediatorRegistryPanel() {
  const session: Session | null = useSession();
  const client = useQueryClient();
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [queue, setQueue] = useState<{ pubkey: string; rows: MediatorRegistration[] } | null>(null);
  const form = useForm<MediatorApplicationValues>({
    resolver: zodResolver(mediatorApplicationSchema),
    defaultValues: { displayName: "" },
  });

  const mine = useQuery({
    queryKey: ["mediator-registration", session?.pubkey],
    queryFn: () => getMyMediatorRegistration(session!.token),
    enabled: Boolean(session?.token),
  });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setFailure("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["mediator-registration"] });
      await client.invalidateQueries({ queryKey: ["disputes"] });
      await client.invalidateQueries({ queryKey: ["approved-mediators"] });
    } catch (e) {
      setFailure(errorMessage(e, "Registry operation failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!session?.token) return null;

  const onApply = form.handleSubmit((values: MediatorApplicationValues) =>
    run(async () => {
      const secret = getSigningCapability(session.pubkey);
      if (secret) {
        await registerMediator(
          session.token,
          values.displayName,
          mediatorRegistrationSignature(secret, session.pubkey, values.displayName),
        );
      } else {
        await registerMediatorWithEvent(
          session.token,
          values.displayName,
          await mediatorRegistrationEvent(session.pubkey, values.displayName),
        );
      }
      setMessage("Application submitted. Approval is required.");
    }),
  );

  return (
    <Card tone="solid" role="region" aria-label="Mediator registration">
      <CardHeader
        title="Mediator registration"
        description="Prove control of your signing identity to apply. An administrator must approve your application before you can mediate. Suspension blocks new mediator actions on existing disputes too; history stays readable."
      />
      {mine.isLoading ? <Skeleton className="h-10 w-full rounded-full" /> : null}
      {mine.isError ? (
        <Alert tone="warn" title="Registry unavailable">
          Apply the reviewed registry migration to your chosen database first.
        </Alert>
      ) : null}
      {mine.data ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <ShieldCheck aria-hidden="true" className="size-4 text-violet-soft" />
          <span>{mine.data.display_name}</span>
          <Badge tone={REGISTRATION_TONE[mine.data.status] ?? "neutral"} dot>
            {mine.data.status}
          </Badge>
        </div>
      ) : mine.isLoading ? null : (
        <form onSubmit={onApply} className="flex flex-col gap-3" noValidate>
          <Input
            label="Mediator display name"
            required
            error={form.formState.errors.displayName?.message}
            disabled={mine.isError}
            {...form.register("displayName")}
          />
          <Button type="submit" loading={busy} disabled={mine.isError} className="w-full sm:w-fit">
            Sign and submit application
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const rows = await reviewMediators(session.token);
              setQueue({ pubkey: session.pubkey, rows });
            })
          }
        >
          Administrator: review registrations
        </Button>
        {queue?.pubkey === session.pubkey ? (
          queue.rows.length === 0 ? (
            <p className="text-sm text-ink-muted">No registrations to review.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {queue.rows.map((row) => (
                <li
                  key={row.pubkey}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-glass p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      {row.display_name}
                      <Badge tone={REGISTRATION_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
                    </span>
                    <HashValue value={row.pubkey} head={12} tail={6} />
                  </div>
                  <div className="flex gap-2">
                    {(["approved", "suspended"] as const).map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant={status === "approved" ? "primary" : "danger"}
                        disabled={busy || row.status === status}
                        onClick={() =>
                          void run(async () => {
                            await setMediatorStatus(session.token, row.pubkey, status);
                            setQueue({ pubkey: session.pubkey, rows: await reviewMediators(session.token) });
                          })
                        }
                      >
                        {status === "approved" ? "Approve" : "Suspend"}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      {message ? <Alert tone="ok">{message}</Alert> : null}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
    </Card>
  );
}
