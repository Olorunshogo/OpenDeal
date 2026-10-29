import { Download } from "lucide-react";
import { Alert, Button, Card, CardHeader } from "@/components/ui";
import { saveBlobAsFile } from "@/lib/download";
import type { ReceiptVerification } from "@/lib/receipt-verification";

// === Types

export interface ReceiptPanelProps {
  dealId: string;
  receiptJson: string;
  verification: ReceiptVerification | null;
}

// === Component

export function ReceiptPanel({ dealId, receiptJson, verification }: ReceiptPanelProps): React.JSX.Element {
  return (
    <Card tone={verification?.valid ? "violet" : "solid"}>
      <CardHeader title="Receipt" description="A hash-chained record of every event in this deal." />
      {verification?.valid ? (
        <div className="flex flex-col gap-3">
          <Alert tone="ok" title="Receipt consistency checks passed">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
              {verification.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </Alert>
          <Alert tone="warn" title="This does not independently prove current blockchain confirmation">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs">
              {verification.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : (
        <Alert tone="danger" title="Receipt verification failed">
          {verification && !verification.valid ? verification.error : "No result."}
        </Alert>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="w-full sm:w-fit"
        leading={<Download className="size-3.5" />}
        onClick={() =>
          saveBlobAsFile(new Blob([receiptJson], { type: "application/json" }), `receipt-${dealId.slice(0, 8)}.json`)
        }
      >
        Download receipt JSON
      </Button>
      <details className="rounded-2xl border border-line">
        <summary className="cursor-pointer px-4 py-2.5 text-xs text-ink-muted hover:text-ink">Receipt JSON</summary>
        <pre className="max-h-80 overflow-auto border-t border-line p-4 font-mono text-[11px] break-all whitespace-pre-wrap text-ink-muted">
          {receiptJson}
        </pre>
      </details>
    </Card>
  );
}
