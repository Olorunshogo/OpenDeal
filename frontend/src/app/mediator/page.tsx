"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { resolveDispute } from "@/lib/api";
import { loadSession } from "@/lib/session";

export default function MediatorPage() {
  const [disputeId, setDisputeId] = useState("");
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(decision: "release" | "refund") {
    setError(null);
    setMessage(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Save a mediator session token first.");
      return;
    }
    try {
      await resolveDispute(session.token, disputeId.trim(), decision, rationale.trim());
      setMessage(`Dispute resolved with decision: ${decision}. For multisig, parties still complete the PSBT.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "resolve failed");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl animate-rise">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Mediator</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">Dispute desk</h1>
        <p className="mt-2 text-[var(--ink-muted)]">
          A mediator decision updates protocol state and recommended payout. It does not move Bitcoin
          alone. 2-of-3 signatures are still required for multisig settlement.
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Dispute id</span>
            <input
              className="rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2 font-mono text-xs"
              value={disputeId}
              onChange={(e) => setDisputeId(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Rationale</span>
            <textarea
              className="min-h-28 rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          {message ? <p className="text-sm text-[var(--ok)]">{message}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => resolve("release")}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)]"
            >
              Release to seller
            </button>
            <button
              type="button"
              onClick={() => resolve("refund")}
              className="rounded border border-[var(--line)] px-4 py-2 text-sm"
            >
              Refund buyer
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
