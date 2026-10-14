"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { createDeal } from "@/lib/api";
import { loadSession } from "@/lib/session";

export default function NewDealPage() {
  const router = useRouter();
  const [title, setTitle] = useState("Used laptop");
  const [amountSats, setAmountSats] = useState("50000");
  const [buyerPubkey, setBuyerPubkey] = useState("");
  const [mediatorPubkey, setMediatorPubkey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Save a session token first (footer).");
      return;
    }
    setBusy(true);
    try {
      const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const deal = await createDeal(session.token, {
        title,
        amount_sats: Number(amountSats),
        buyer_pubkey: buyerPubkey.trim(),
        mediator_pubkey: mediatorPubkey.trim(),
        delivery_deadline: deadline,
        acceptance_window_hours: 48,
      });
      router.push(`/deals/${deal.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create deal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl animate-rise">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Create</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">New deal</h1>
        <p className="mt-2 text-[var(--ink-muted)]">
          Seller proposes terms. Buyer and seller both sign the same canonical agreement.
        </p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Title</span>
            <input
              className="rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Amount (sats)</span>
            <input
              type="number"
              min={1}
              className="rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2"
              value={amountSats}
              onChange={(e) => setAmountSats(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Buyer pubkey</span>
            <input
              className="rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2 font-mono text-xs"
              value={buyerPubkey}
              onChange={(e) => setBuyerPubkey(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--ink-muted)]">Mediator pubkey</span>
            <input
              className="rounded border border-[var(--line)] bg-[var(--bg-lift)]/50 px-3 py-2 font-mono text-xs"
              value={mediatorPubkey}
              onChange={(e) => setMediatorPubkey(e.target.value)}
              required
            />
          </label>
          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 w-fit rounded bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create deal"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
