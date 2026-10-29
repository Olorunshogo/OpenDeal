"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { EvidenceItemCard } from "@/components/deal/EvidenceItemCard";
import { Alert, Button, Card, CardHeader, Input, Skeleton, Textarea } from "@/components/ui";
import { downloadEvidenceContent, listEvidence, submitEvidence, type Evidence } from "@/lib/api";
import { saveBlobAsFile } from "@/lib/download";
import { assertEvidenceIntegrity, evidenceFileName } from "@/lib/evidence";
import { errorMessage } from "@/lib/server-errors";
import { loadSession } from "@/lib/session";
import { evidenceSchema, type EvidenceValues } from "@/schemas/deal";

// === Types

export interface DealEvidencePanelProps {
  token: string;
  viewer: string | undefined;
  dealId: string;
  canSubmit: boolean;
}

// === Component

export function DealEvidencePanel({ token, viewer, dealId, canSubmit }: DealEvidencePanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<EvidenceValues>({
    resolver: zodResolver(evidenceSchema),
    defaultValues: { kind: "note", content: "" },
  });
  const evidenceQuery = useQuery({
    queryKey: ["evidence", dealId, viewer],
    queryFn: () => listEvidence(token, dealId),
    enabled: Boolean(dealId && token),
  });

  async function onDownload(item: Evidence) {
    setDownloadError(null);
    const current = loadSession();
    if (!current?.token) {
      setDownloadError("Sign in first (Sign in page).");
      return;
    }
    setDownloadingId(item.id);
    try {
      const blob = await downloadEvidenceContent(current.token, dealId, item.id);
      await assertEvidenceIntegrity(blob, item.content_sha256);
      saveBlobAsFile(blob, evidenceFileName(item));
    } catch (err) {
      setDownloadError(errorMessage(err, "evidence download failed"));
    } finally {
      setDownloadingId(null);
    }
  }

  const onSubmit = form.handleSubmit(async (values: EvidenceValues) => {
    setSubmitError(null);
    const current = loadSession();
    if (!current?.token) {
      setSubmitError("Sign in first (Sign in page).");
      return;
    }
    try {
      await submitEvidence(current.token, dealId, { kind: values.kind, content: values.content });
      form.reset({ kind: values.kind, content: "" });
      await queryClient.invalidateQueries({ queryKey: ["evidence", dealId] });
    } catch (err) {
      setSubmitError(errorMessage(err, "evidence submit failed"));
    }
  });

  return (
    <Card>
      <CardHeader
        title="Evidence"
        description="Every item is stored with a SHA-256 hash. Download to inspect the original content."
      />
      {evidenceQuery.isPending ? <Skeleton className="h-24 w-full rounded-2xl" /> : null}
      {evidenceQuery.isError ? <Alert tone="danger">Could not load evidence.</Alert> : null}
      {evidenceQuery.isSuccess && !evidenceQuery.data.length ? (
        <p className="text-sm text-ink-subtle">No evidence submitted yet.</p>
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
      {downloadError ? <Alert tone="danger">{downloadError}</Alert> : null}
      {canSubmit ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t border-line pt-4" noValidate>
          <Input label="Kind" required error={form.formState.errors.kind?.message} {...form.register("kind")} />
          <Textarea
            label="Evidence"
            required
            placeholder="Describe what happened, link a photo host, etc."
            error={form.formState.errors.content?.message}
            {...form.register("content")}
          />
          {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            loadingLabel="Submitting…"
            leading={<Send className="size-4" />}
            className="w-full sm:w-fit"
          >
            Submit evidence
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
