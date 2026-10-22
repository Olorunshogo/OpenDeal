"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Textarea } from "@/components/ui/Textarea";
import { listDisputes, resolveDispute, type OpenDisputeSummary } from "@/lib/api";
import { loadSession, type Session } from "@/lib/session";

export default function MediatorPage() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<OpenDisputeSummary | null>(null);
  const [rationale, setRationale] = useState("");
  const [resolvedDecision, setResolvedDecision] = useState<"release" | "refund" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  const disputesQuery = useQuery({
    queryKey: ["disputes", "open", session?.token],
    queryFn: () => listDisputes(session!.token),
    enabled: Boolean(session?.token),
  });

  async function resolve(decision: "release" | "refund") {
    setError(null);
    setMessage(null);
    setResolvedDecision(null);
    if (!session?.token) {
      setError("Sign in as a mediator first (footer).");
      return;
    }
    if (!selected) {
      setError("Pick a dispute from the list first.");
      return;
    }
    try {
      await resolveDispute(session.token, selected.id, decision, rationale.trim());
      setMessage(
        `Dispute resolved with decision: ${decision}. For multisig, parties still complete the PSBT.`,
      );
      setResolvedDecision(decision);
      await queryClient.invalidateQueries({ queryKey: ["disputes", "open"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "resolve failed");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl animate-rise">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Mediator</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">Dispute desk</h1>
        <p className="mt-2 text-[var(--ink-muted)]">
          A mediator decision updates protocol state and recommended payout. It does not move
          Bitcoin alone. 2-of-3 signatures are still required for multisig settlement.
        </p>

        {!session?.token ? (
          <p className="mt-6 text-sm text-[var(--danger)]">Sign in as a mediator first (footer).</p>
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Open disputes
              </p>
              {(disputesQuery.data ?? []).map((dispute) => (
                <button
                  key={dispute.id}
                  type="button"
                  onClick={() => setSelected(dispute)}
                  className={`rounded border px-3 py-2 text-left text-sm transition ${
                    selected?.id === dispute.id
                      ? "border-[var(--accent)] bg-[var(--bg-lift)]/60"
                      : "border-[var(--line)] hover:border-[var(--accent)]/60"
                  }`}
                >
                  <p className="font-medium">{dispute.title}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {dispute.amount_sats.toLocaleString()} sats · opened by{" "}
                    {dispute.opened_by.slice(0, 8)}…
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{dispute.reason}</p>
                </button>
              ))}
              {disputesQuery.isSuccess && !disputesQuery.data?.length ? (
                <p className="text-sm text-[var(--ink-muted)]">No open disputes.</p>
              ) : null}
              {disputesQuery.isError ? (
                <p className="text-sm text-[var(--danger)]">
                  Could not load disputes — are you a configured mediator?
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              {selected ? (
                <p className="text-sm">
                  Deciding on <span className="text-[var(--accent-soft)]">{selected.title}</span> ·{" "}
                  {selected.amount_sats.toLocaleString()} sats
                </p>
              ) : (
                <p className="text-sm text-[var(--ink-muted)]">Pick a dispute from the list.</p>
              )}
              <Textarea label="Rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
              {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
              {message ? <p className="text-sm text-[var(--ok)]">{message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => resolve("release")}
                  className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
                >
                  Release to seller
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={() => resolve("refund")}
                  className="rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
                >
                  Refund buyer
                </button>
              </div>
              {selected && resolvedDecision ? (
                <Link
                  href={`/deals/${selected.agreement_id}?purpose=${
                    resolvedDecision === "refund" ? "refund_buyer" : "payout_seller"
                  }`}
                  className="text-sm underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--accent-soft)]"
                >
                  Open deal PSBT panel →
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
