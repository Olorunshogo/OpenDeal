"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyMediatorRegistration,
  registerMediator,
  registerMediatorWithEvent,
  reviewMediators,
  setMediatorStatus,
  type MediatorRegistration,
} from "@/lib/api";
import { getSigningCapability, useSession } from "@/lib/session";
import {
  mediatorRegistrationSignature,
  mediatorRegistrationEvent,
} from "@/lib/mediator-registration";
import { Input } from "@/components/ui/Input";

export function MediatorRegistryPanel() {
  const session = useSession(),
    client = useQueryClient();
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [queue, setQueue] = useState<{
    pubkey: string;
    rows: MediatorRegistration[];
  } | null>(null);
  const mine = useQuery({
    queryKey: ["mediator-registration", session?.pubkey],
    queryFn: () => getMyMediatorRegistration(session!.token),
    enabled: Boolean(session?.token),
  });
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["mediator-registration"] });
      await client.invalidateQueries({ queryKey: ["disputes"] });
      await client.invalidateQueries({ queryKey: ["approved-mediators"] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Registry operation failed");
    } finally {
      setBusy(false);
    }
  }
  if (!session?.token) return null;
  return (
    <section className="flex flex-col gap-3 rounded border border-[var(--line)] p-4">
      <h2 className="text-xl">Mediator registration</h2>
      <p className="text-sm text-[var(--ink-muted)]">
        Prove control of your signing identity to apply. An administrator must
        approve your application before you can mediate. Suspension blocks new
        mediator actions on existing disputes too; history stays readable.
      </p>
      {mine.isLoading ? <p>Loading registration…</p> : null}
      {mine.isError ? (
        <p role="alert">
          Registry unavailable. Apply the reviewed registry migration to your
          chosen database first.
        </p>
      ) : null}
      {mine.data ? (
        <p>
          Status: <strong>{mine.data.status}</strong> · {mine.data.display_name}
        </p>
      ) : (
        <>
          <Input
            label="Mediator display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            disabled={busy || !name.trim() || mine.isError}
            onClick={() =>
              void run(async () => {
                const secret = getSigningCapability(session.pubkey);
                if (secret) {
                  await registerMediator(
                    session.token,
                    name.trim(),
                    mediatorRegistrationSignature(secret, session.pubkey, name)
                  );
                } else {
                  await registerMediatorWithEvent(
                    session.token,
                    name.trim(),
                    await mediatorRegistrationEvent(session.pubkey, name)
                  );
                }
                setMessage("Application submitted. Approval is required.");
              })
            }
          >
            Sign and submit application
          </button>
        </>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const rows = await reviewMediators(session.token);
            setQueue({ pubkey: session.pubkey, rows });
          })
        }
      >
        Administrator: review registrations
      </button>
      {queue?.pubkey === session.pubkey
        ? queue.rows.map((row) => (
            <div
              className="rounded border border-[var(--line)] p-3 text-sm"
              key={row.pubkey}
            >
              <p>
                {row.display_name} · {row.status} ·{" "}
                <span className="font-mono">{row.pubkey.slice(0, 12)}…</span>
              </p>
              {(["approved", "suspended"] as const).map((status) => (
                <button
                  className="mr-4 underline"
                  key={status}
                  disabled={busy || row.status === status}
                  onClick={() =>
                    void run(async () => {
                      await setMediatorStatus(
                        session.token,
                        row.pubkey,
                        status
                      );
                      setQueue({
                        pubkey: session.pubkey,
                        rows: await reviewMediators(session.token),
                      });
                    })
                  }
                >
                  {status === "approved" ? "Approve" : "Suspend"}
                </button>
              ))}
            </div>
          ))
        : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
