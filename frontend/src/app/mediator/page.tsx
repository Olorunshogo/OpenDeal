"use client";

import Link from "next/link";
import { MediatorRegistryPanel } from "@/components/MediatorRegistryPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Textarea } from "@/components/ui/Textarea";
import {
  downloadEvidenceContent,
  getDeal,
  getDisputeDetail,
  getEvents,
  listEvidence,
  listDisputes,
  resolveDispute,
  type Deal,
  type DealEvent,
  type Dispute,
  type Evidence,
  type OpenDisputeSummary,
} from "@/lib/api";
import { useSession, type Session } from "@/lib/session";
import { canMediatorResolve } from "@/lib/workflow";
import { assertEvidenceIntegrity } from "@/lib/evidence";

export default function MediatorPage() {
  const queryClient = useQueryClient();
  const session: Session | null = useSession();
  const token: string = session?.token ?? "";
  const detailRef = useRef<HTMLDivElement>(null);
  const [selectedForIdentity, setSelectedForIdentity] = useState<{
    dispute: OpenDisputeSummary;
    pubkey: string;
  } | null>(null);
  const selected =
    selectedForIdentity && selectedForIdentity.pubkey === session?.pubkey
      ? selectedForIdentity.dispute
      : null;
  const [rationale, setRationale] = useState<string>("");
  const [resolvedDecision, setResolvedDecision] = useState<"release" | "refund" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<boolean>(false);

  const disputesQuery = useQuery({
    queryKey: ["disputes", "open", session?.pubkey],
    queryFn: () => listDisputes(token),
    enabled: Boolean(token),
  });
  const detailQuery = useQuery({
    queryKey: ["dispute", selected?.id, session?.pubkey],
    queryFn: () => getDisputeDetail(token, selected!.id),
    enabled: Boolean(token && selected),
  });
  const dealQuery = useQuery({
    queryKey: ["deal", selected?.agreement_id, session?.pubkey],
    queryFn: () => getDeal(token, selected!.agreement_id),
    enabled: Boolean(token && selected),
  });
  const evidenceQuery = useQuery({
    queryKey: ["evidence", selected?.agreement_id, session?.pubkey],
    queryFn: () => listEvidence(token, selected!.agreement_id),
    enabled: Boolean(token && selected),
  });
  const eventsQuery = useQuery({
    queryKey: ["events", selected?.agreement_id, session?.pubkey],
    queryFn: () => getEvents(token, selected!.agreement_id),
    enabled: Boolean(token && selected),
  });
  const detail: Dispute | undefined = detailQuery.data;
  const deal: Deal | undefined = dealQuery.data;
  const evidence: Evidence[] = evidenceQuery.data ?? [];
  const events: DealEvent[] = eventsQuery.data ?? [];
  const isResolved: boolean = Boolean(detail && detail.status !== "open");
  const canResolve = canMediatorResolve(
    disputesQuery.isSuccess,
    detail?.status,
    Boolean(detail),
    rationale,
  );

  function onSelectDispute(dispute: OpenDisputeSummary) {
    setSelectedForIdentity({ dispute, pubkey: session?.pubkey ?? "" });
    setError(null);
    setMessage(null);
    setResolvedDecision(null);
    setRationale("");
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function resolve(decision: "release" | "refund") {
    setError(null);
    setMessage(null);
    setResolvedDecision(null);
    if (!token) {
      setError("Sign in as a mediator first (Sign in page).");
      return;
    }
    if (!selected || !detail || isResolved || !rationale.trim()) {
      setError("Pick a dispute from the list first.");
      return;
    }
    setResolving(true);
    try {
      await resolveDispute(token, selected.id, decision, rationale.trim());
      setMessage(
        `Dispute resolved with decision: ${decision}. For multisig, parties still complete the PSBT.`,
      );
      setResolvedDecision(decision);
      await queryClient.invalidateQueries({ queryKey: ["disputes", "open"] });
      await queryClient.invalidateQueries({ queryKey: ["dispute", selected.id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "resolve failed");
    } finally {
      setResolving(false);
    }
  }

  async function downloadEvidence(item: Evidence) {
    if (!selected || !token) {
      setError("Sign in as the assigned mediator first.");
      return;
    }
    setError(null);
    try {
      const blob = await downloadEvidenceContent(token, selected.agreement_id, item.id);
      await assertEvidenceIntegrity(blob, item.content_sha256);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `evidence-${item.id.slice(0, 8)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "evidence download failed");
    }
  }

  const settlementPurpose: string =
    (resolvedDecision ?? detail?.decision) === "refund" ? "refund_buyer" : "payout_seller";

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 animate-rise">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Mediator</p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            Dispute desk
          </h1>
          <p className="text-[var(--ink-muted)]">
            A mediator decision updates protocol state and recommended payout. It does not move
            Bitcoin alone. 2-of-3 signatures are still required for multisig settlement.
          </p>
        </div>

        <MediatorRegistryPanel />
        {!token ? (
          <p className="text-sm text-[var(--danger)]">
            {session
              ? "Your sign-in expired. Use Sign in again in the footer."
              : "Sign in as a mediator first (Sign in page)."}
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Open disputes
              </p>
              {(disputesQuery.data ?? []).map((dispute) => (
                <button
                  key={dispute.id}
                  type="button"
                  onClick={() => onSelectDispute(dispute)}
                  aria-pressed={selected?.id === dispute.id}
                  className={`flex flex-col gap-1 rounded border px-3 py-2 text-left text-sm transition ${
                    selected?.id === dispute.id
                      ? "border-[var(--accent)] bg-[var(--bg-lift)]/60"
                      : "border-[var(--line)] hover:border-[var(--accent)]/60"
                  }`}
                >
                  <p className="break-words font-medium">{dispute.title}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {dispute.amount_sats.toLocaleString()} sats · opened by{" "}
                    {dispute.opened_by.slice(0, 8)}…
                  </p>
                  <p className="line-clamp-2 text-xs text-[var(--ink-muted)]">{dispute.reason}</p>
                </button>
              ))}
              {disputesQuery.isSuccess && !disputesQuery.data?.length ? (
                <p className="text-sm text-[var(--ink-muted)]">No open disputes.</p>
              ) : null}
              {disputesQuery.isError ? (
                <p className="text-sm text-[var(--danger)]">
                  Could not load disputes. Is your identity an approved mediator?
                </p>
              ) : null}
            </div>

            <div ref={detailRef} className="flex min-w-0 scroll-mt-6 flex-col gap-4">
              {!selected ? (
                <p className="text-sm text-[var(--ink-muted)]">Pick a dispute from the list.</p>
              ) : (
                <div className="flex flex-col gap-3 rounded border border-[var(--line)] bg-[var(--bg-lift)]/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="break-words font-[family-name:var(--font-display)] text-xl">
                      {selected.title}
                    </h2>
                    <span
                      className={`rounded border px-2 py-0.5 text-xs ${
                        isResolved
                          ? "border-[var(--ok)]/50 text-[var(--ok)]"
                          : "border-[var(--accent)]/50 text-[var(--accent-soft)]"
                      }`}
                    >
                      {detail?.status ?? selected.status}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {selected.amount_sats.toLocaleString()} sats
                  </p>
                  {dealQuery.isLoading ? (
                    <p className="text-xs text-[var(--ink-muted)]">Loading deal context…</p>
                  ) : null}
                  {dealQuery.isError ? (
                    <p className="text-sm text-[var(--danger)]">
                      {dealQuery.error instanceof Error
                        ? dealQuery.error.message
                        : "Could not load deal context."}
                    </p>
                  ) : null}
                  {deal ? (
                    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs text-[var(--ink-muted)]">Deal status</dt>
                        <dd>{deal.status}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs text-[var(--ink-muted)]">Network</dt>
                        <dd>{deal.network}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5 sm:col-span-2">
                        <dt className="text-xs text-[var(--ink-muted)]">Buyer</dt>
                        <dd className="break-all font-mono text-xs">{deal.buyer_pubkey}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5 sm:col-span-2">
                        <dt className="text-xs text-[var(--ink-muted)]">Seller</dt>
                        <dd className="break-all font-mono text-xs">{deal.seller_pubkey}</dd>
                      </div>
                    </dl>
                  ) : null}
                  {detailQuery.isLoading ? (
                    <p className="text-sm text-[var(--ink-muted)]">Loading dispute…</p>
                  ) : null}
                  {detailQuery.isError ? (
                    <p className="text-sm text-[var(--danger)]">
                      {detailQuery.error instanceof Error
                        ? detailQuery.error.message
                        : "Could not load this dispute."}
                    </p>
                  ) : null}
                  {detail ? (
                    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div className="flex flex-col gap-0.5 sm:col-span-2">
                        <dt className="text-xs text-[var(--ink-muted)]">Reason</dt>
                        <dd className="whitespace-pre-wrap break-words">{detail.reason}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs text-[var(--ink-muted)]">Opened by</dt>
                        <dd className="break-all font-mono text-xs">{detail.opened_by}</dd>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs text-[var(--ink-muted)]">Opened at</dt>
                        <dd>{new Date(detail.created_at).toLocaleString()}</dd>
                      </div>
                      {detail.decision ? (
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-xs text-[var(--ink-muted)]">Decision</dt>
                          <dd className="text-[var(--ok)]">{detail.decision}</dd>
                        </div>
                      ) : null}
                      {detail.resolved_at ? (
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-xs text-[var(--ink-muted)]">Resolved at</dt>
                          <dd>{new Date(detail.resolved_at).toLocaleString()}</dd>
                        </div>
                      ) : null}
                      {detail.resolved_by ? (
                        <div className="flex flex-col gap-0.5 sm:col-span-2">
                          <dt className="text-xs text-[var(--ink-muted)]">Resolved by</dt>
                          <dd className="break-all font-mono text-xs">{detail.resolved_by}</dd>
                        </div>
                      ) : null}
                      {detail.rationale ? (
                        <div className="flex flex-col gap-0.5 sm:col-span-2">
                          <dt className="text-xs text-[var(--ink-muted)]">Rationale</dt>
                          <dd className="whitespace-pre-wrap break-words">{detail.rationale}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
                    <h3 className="text-sm font-medium">Evidence</h3>
                    {evidenceQuery.isLoading ? (
                      <p className="text-xs text-[var(--ink-muted)]">Loading evidence…</p>
                    ) : null}
                    {evidenceQuery.isError ? (
                      <p className="text-xs text-[var(--danger)]">Could not load evidence.</p>
                    ) : null}
                    {evidence.map((item) => (
                      <div key={item.id} className="flex flex-col gap-1 rounded border border-[var(--line)] p-2">
                        <p className="text-xs text-[var(--accent-soft)]">{item.kind}</p>
                        <p className="whitespace-pre-wrap break-words text-sm">{item.content}</p>
                        <p className="break-all font-mono text-[10px] text-[var(--ink-muted)]">
                          SHA-256 · {item.content_sha256 ?? "not available"}
                        </p>
                        <button
                          type="button"
                          onClick={() => void downloadEvidence(item)}
                          className="w-fit text-xs underline decoration-[var(--line)] underline-offset-4"
                        >
                          Download evidence
                        </button>
                      </div>
                    ))}
                    {evidenceQuery.isSuccess && evidence.length === 0 ? (
                      <p className="text-xs text-[var(--ink-muted)]">No evidence submitted.</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-3">
                    <h3 className="text-sm font-medium">Deal history</h3>
                    {eventsQuery.isError ? (
                      <p className="text-xs text-[var(--danger)]">Could not load deal history.</p>
                    ) : null}
                    <ol className="flex flex-col gap-2">
                      {events.map((event) => (
                        <li key={event.sequence} className="text-xs">
                          <span className="text-[var(--accent-soft)]">
                            #{event.sequence} · {event.kind}
                          </span>
                          <span className="ml-2 text-[var(--ink-muted)]">
                            {new Date(event.created_at).toLocaleString()}
                          </span>
                        </li>
                      ))}
                      {eventsQuery.isSuccess && events.length === 0 ? (
                        <li className="text-xs text-[var(--ink-muted)]">No events yet.</li>
                      ) : null}
                    </ol>
                  </div>
                  <Link
                    href={`/deals/${selected.agreement_id}`}
                    className="w-fit text-sm underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--accent-soft)]"
                  >
                    View deal
                  </Link>
                </div>
              )}

              {selected && !isResolved ? (
                <Textarea
                  label="Rationale"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                />
              ) : null}
              {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
              {message ? <p className="text-sm text-[var(--ok)]">{message}</p> : null}
              {selected && !isResolved ? (
                <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                  <button
                    type="button"
                    disabled={resolving || !canResolve}
                    onClick={() => resolve("release")}
                    className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--bg-deep)] disabled:opacity-40"
                  >
                    {resolving ? "Resolving…" : "Release to seller"}
                  </button>
                  <button
                    type="button"
                    disabled={resolving || !canResolve}
                    onClick={() => resolve("refund")}
                    className="rounded border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-40"
                  >
                    Refund buyer
                  </button>
                </div>
              ) : null}
              {selected && (resolvedDecision || isResolved) ? (
                <Link
                  href={`/deals/${selected.agreement_id}?purpose=${settlementPurpose}`}
                  className="w-fit text-sm underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--accent-soft)]"
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
