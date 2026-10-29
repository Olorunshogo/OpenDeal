"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { EvidenceItemCard } from "@/components/deal/EvidenceItemCard";
import {
  Alert,
  Amount,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DataList,
  HashValue,
  Skeleton,
  StatusBadge,
  Textarea,
  Timeline,
  type TimelineEntry,
} from "@/components/ui";
import {
  downloadEvidenceContent,
  getDeal,
  getDisputeDetail,
  getEvents,
  listEvidence,
  resolveDispute,
  type Dispute,
  type Evidence,
  type OpenDisputeSummary,
} from "@/lib/api";
import { saveBlobAsFile } from "@/lib/download";
import { assertEvidenceIntegrity, evidenceFileName } from "@/lib/evidence";
import { errorMessage } from "@/lib/server-errors";
import { canMediatorResolve } from "@/lib/workflow";
import { disputeResolutionSchema, type DisputeResolutionValues } from "@/schemas/mediator";
import { useOpenDisputes } from "./DisputeList";

// === Types

interface PanelProps {
  token: string;
  viewer: string | undefined;
  dispute: OpenDisputeSummary;
}

type Decision = "release" | "refund";

// === Data sections

function DealContext({ token, viewer, dealId }: { token: string; viewer: string | undefined; dealId: string }) {
  const dealQuery = useQuery({
    queryKey: ["deal", dealId, viewer],
    queryFn: () => getDeal(token, dealId),
    enabled: Boolean(token),
  });
  if (dealQuery.isPending) {
    return <Skeleton className="h-16 w-full rounded-2xl" />;
  }
  if (dealQuery.isError) {
    return <Alert tone="danger">{errorMessage(dealQuery.error, "Could not load deal context.")}</Alert>;
  }
  const deal = dealQuery.data;
  return (
    <DataList
      items={[
        { label: "Deal status", value: <StatusBadge status={deal.status} /> },
        { label: "Network", value: <Badge>{deal.network}</Badge> },
        { label: "Buyer", value: <HashValue value={deal.buyer_pubkey} /> },
        { label: "Seller", value: <HashValue value={deal.seller_pubkey} /> },
      ]}
    />
  );
}

function DisputeEvidence({ token, viewer, dealId }: { token: string; viewer: string | undefined; dealId: string }) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidenceQuery = useQuery({
    queryKey: ["evidence", dealId, viewer],
    queryFn: () => listEvidence(token, dealId),
    enabled: Boolean(token),
  });

  async function onDownload(item: Evidence) {
    setError(null);
    setDownloadingId(item.id);
    try {
      const blob = await downloadEvidenceContent(token, dealId, item.id);
      await assertEvidenceIntegrity(blob, item.content_sha256);
      saveBlobAsFile(blob, evidenceFileName(item));
    } catch (downloadError) {
      setError(errorMessage(downloadError, "evidence download failed"));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-sm font-medium text-ink">Evidence</h3>
      {evidenceQuery.isPending ? <Skeleton className="h-20 w-full rounded-2xl" /> : null}
      {evidenceQuery.isError ? <Alert tone="danger">Could not load evidence.</Alert> : null}
      {evidenceQuery.isSuccess && !evidenceQuery.data.length ? (
        <p className="text-xs text-ink-subtle">No evidence submitted.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(evidenceQuery.data ?? []).map((item) => (
          <EvidenceItemCard
            key={item.id}
            item={item}
            downloading={downloadingId === item.id}
            onDownload={(target) => void onDownload(target)}
          />
        ))}
      </ul>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </section>
  );
}

function DisputeHistory({ token, viewer, dealId }: { token: string; viewer: string | undefined; dealId: string }) {
  const eventsQuery = useQuery({
    queryKey: ["events", dealId, viewer],
    queryFn: () => getEvents(token, dealId),
    enabled: Boolean(token),
  });
  const entries: TimelineEntry[] = (eventsQuery.data ?? []).map((event) => ({
    id: event.sequence,
    title: `#${event.sequence} · ${event.kind}`,
    meta: new Date(event.created_at).toLocaleString(),
    tone: "violet",
  }));
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-sm font-medium text-ink">Deal history</h3>
      {eventsQuery.isPending ? <Skeleton className="h-16 w-full rounded-2xl" /> : null}
      {eventsQuery.isError ? <Alert tone="danger">Could not load deal history.</Alert> : null}
      {eventsQuery.isSuccess && !entries.length ? <p className="text-xs text-ink-subtle">No events yet.</p> : null}
      <Timeline entries={entries} />
    </section>
  );
}

// === Component

export function DisputeDetailPanel({ token, viewer, dispute }: PanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const disputesQuery = useOpenDisputes(token, viewer);
  const [resolvedDecision, setResolvedDecision] = useState<Decision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<DisputeResolutionValues>({
    resolver: zodResolver(disputeResolutionSchema),
    defaultValues: { rationale: "" },
  });
  const rationale: string = useWatch({ control: form.control, name: "rationale" });

  const detailQuery = useQuery({
    queryKey: ["dispute", dispute.id, viewer],
    queryFn: () => getDisputeDetail(token, dispute.id),
    enabled: Boolean(token),
  });
  const detail: Dispute | undefined = detailQuery.data;
  const isResolved: boolean = Boolean(detail && detail.status !== "open");
  const canResolve: boolean = canMediatorResolve(disputesQuery.isSuccess, detail?.status, Boolean(detail), rationale);

  async function resolve(decision: Decision, values: DisputeResolutionValues) {
    setError(null);
    setMessage(null);
    setResolvedDecision(null);
    if (!detail || isResolved || !values.rationale.trim()) {
      setError("Pick a dispute from the list first.");
      return;
    }
    try {
      await resolveDispute(token, dispute.id, decision, values.rationale.trim());
      setMessage(`Dispute resolved with decision: ${decision}. For multisig, parties still complete the PSBT.`);
      setResolvedDecision(decision);
      await queryClient.invalidateQueries({ queryKey: ["disputes", "open"] });
      await queryClient.invalidateQueries({ queryKey: ["dispute", dispute.id] });
    } catch (err) {
      setError(errorMessage(err, "resolve failed"));
    }
  }

  const settlementPurpose: string = (resolvedDecision ?? detail?.decision) === "refund" ? "refund_buyer" : "payout_seller";
  const submitting: boolean = form.formState.isSubmitting;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={dispute.title}
          description={<Amount sats={dispute.amount_sats} size="sm" />}
          action={
            <Badge tone={isResolved ? "ok" : "warn"} dot>
              {detail?.status ?? dispute.status}
            </Badge>
          }
        />
        <DealContext token={token} viewer={viewer} dealId={dispute.agreement_id} />
        {detailQuery.isPending ? <Skeleton className="h-24 w-full rounded-2xl" /> : null}
        {detailQuery.isError ? (
          <Alert tone="danger">{errorMessage(detailQuery.error, "Could not load this dispute.")}</Alert>
        ) : null}
        {detail ? (
          <DataList
            items={[
              { label: "Reason", value: <span className="whitespace-pre-wrap">{detail.reason}</span>, wide: true },
              { label: "Opened by", value: <HashValue value={detail.opened_by} /> },
              { label: "Opened at", value: new Date(detail.created_at).toLocaleString() },
              ...(detail.decision
                ? [{ label: "Decision", value: <Badge tone="ok">{detail.decision}</Badge> }]
                : []),
              ...(detail.resolved_at
                ? [{ label: "Resolved at", value: new Date(detail.resolved_at).toLocaleString() }]
                : []),
              ...(detail.resolved_by
                ? [{ label: "Resolved by", value: <HashValue value={detail.resolved_by} />, wide: true }]
                : []),
              ...(detail.rationale
                ? [{ label: "Rationale", value: <span className="whitespace-pre-wrap">{detail.rationale}</span>, wide: true }]
                : []),
            ]}
          />
        ) : null}
        <DisputeEvidence token={token} viewer={viewer} dealId={dispute.agreement_id} />
        <DisputeHistory token={token} viewer={viewer} dealId={dispute.agreement_id} />
        <ButtonLink
          href={`/deals/${dispute.agreement_id}`}
          variant="link"
          size="sm"
          className="w-fit"
          trailing={<ExternalLink className="size-3.5" />}
        >
          View deal
        </ButtonLink>
      </Card>

      {!isResolved ? (
        <Card tone="violet">
          <CardHeader
            title="Decide"
            description="Your decision updates the recommended payout. Two of the three signatures still move the Bitcoin."
          />
          <form className="flex flex-col gap-4" noValidate onSubmit={(event) => event.preventDefault()}>
            <Textarea
              label="Rationale"
              required
              hint="Parties see this with your decision."
              error={form.formState.errors.rationale?.message}
              {...form.register("rationale")}
            />
            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <Button
                disabled={!canResolve || submitting}
                loading={submitting}
                onClick={() => void form.handleSubmit((values) => resolve("release", values))()}
              >
                Release to seller
              </Button>
              <Button
                variant="secondary"
                disabled={!canResolve || submitting}
                onClick={() => void form.handleSubmit((values) => resolve("refund", values))()}
              >
                Refund buyer
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="ok">{message}</Alert> : null}
      {resolvedDecision || isResolved ? (
        <ButtonLink
          href={`/deals/${dispute.agreement_id}?purpose=${settlementPurpose}`}
          variant="secondary"
          className="w-full sm:w-fit"
          trailing={<ArrowRight className="size-4" />}
        >
          Open deal PSBT panel
        </ButtonLink>
      ) : null}
    </div>
  );
}
