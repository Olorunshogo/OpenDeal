"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  getDeal,
  getEvents,
  getReceipt,
  openDispute,
  prepareFunding,
  transitionDeal,
  verifyFunding,
  type DealStatus,
} from "@/lib/api";
import { loadSession } from "@/lib/session";

export function DealDetailClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [receiptJson, setReceiptJson] = useState<string | null>(null);

  const dealQuery = useQuery({
    queryKey: ["deal", id],
    queryFn: () => getDeal(id),
    enabled: Boolean(id),
  });
  const eventsQuery = useQuery({
    queryKey: ["events", id],
    queryFn: () => getEvents(id),
    enabled: Boolean(id),
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["deal", id] });
    await queryClient.invalidateQueries({ queryKey: ["events", id] });
  }

  async function withSession(action: (token: string) => Promise<unknown>) {
    setError(null);
    const session = loadSession();
    if (!session?.token) {
      setError("Save a session token first.");
      return;
    }
    try {
      await action(session.token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
    }
  }

  const deal = dealQuery.data;

  return (
    <AppShell>
      <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="animate-rise">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Deal</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
            {deal?.title ?? "Loading…"}
          </h1>
          {deal ? (
            <div className="mt-4 space-y-2 text-sm text-[var(--ink-muted)]">
              <p>
                Status: <span className="text-[var(--ok)]">{deal.status}</span>
              </p>
              <p>
                Settlement:{" "}
                <span className="text-[var(--accent-soft)]">{deal.settlement_model}</span>
              </p>
              <p>
                Network:{" "}
                <span className="network-badge text-[var(--accent-soft)]">{deal.network}</span>
              </p>
              <p>
                Amount: {deal.amount_sats.toLocaleString()} sats ({deal.currency})
              </p>
              {deal.escrow_address ? (
                <p className="break-all font-mono text-xs text-[var(--ink)]">
                  Escrow: {deal.escrow_address}
                </p>
              ) : null}
              {deal.funding_txid ? (
                <p className="break-all font-mono text-xs">Funding tx: {deal.funding_txid}</p>
              ) : null}
              {deal.settlement_txid ? (
                <p className="break-all font-mono text-xs">Settlement tx: {deal.settlement_txid}</p>
              ) : null}
              <p className="break-all font-mono text-[10px] opacity-70">id: {deal.id}</p>
            </div>
          ) : null}

          {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <ActionButton
              label="Prepare funding"
              onClick={() => withSession((t) => prepareFunding(t, id))}
            />
            <ActionButton
              label="Verify funding"
              onClick={() => withSession((t) => verifyFunding(t, id))}
            />
            <ActionButton
              label="Mark shipped"
              onClick={() => withSession((t) => transitionDeal(t, id, "shipped" as DealStatus))}
            />
            <ActionButton
              label="Accept delivery"
              onClick={() => withSession((t) => transitionDeal(t, id, "accepted" as DealStatus))}
            />
            <ActionButton
              label="Open dispute"
              onClick={() =>
                withSession((t) => openDispute(t, id, "Item arrived damaged / not as described"))
              }
            />
            <ActionButton
              label="Export receipt"
              onClick={async () => {
                setError(null);
                try {
                  const receipt = await getReceipt(id);
                  setReceiptJson(JSON.stringify(receipt, null, 2));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "receipt failed");
                }
              }}
            />
          </div>

          {receiptJson ? (
            <pre className="mt-6 max-h-80 overflow-auto rounded border border-[var(--line)] bg-[var(--bg-deep)]/80 p-3 text-[11px] text-[var(--ink-muted)]">
              {receiptJson}
            </pre>
          ) : null}
        </section>

        <section className="animate-rise-delay">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Timeline</h2>
          <ol className="mt-4 space-y-3 border-l border-[var(--line)] pl-4">
            {(eventsQuery.data ?? []).map((event) => (
              <li key={event.sequence} className="text-sm">
                <p className="text-[var(--accent-soft)]">
                  #{event.sequence} · {String(event.kind)}
                </p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {new Date(event.created_at).toLocaleString()}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] opacity-60">
                  {event.actor_pubkey.slice(0, 16)}…
                </p>
              </li>
            ))}
            {!eventsQuery.data?.length ? (
              <li className="text-sm text-[var(--ink-muted)]">No events yet.</li>
            ) : null}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-[var(--line)] px-3 py-2 text-xs text-[var(--ink)] transition hover:border-[var(--accent)]"
    >
      {label}
    </button>
  );
}
