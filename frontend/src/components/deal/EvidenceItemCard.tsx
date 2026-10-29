import { Download } from "lucide-react";
import { Badge, Button, HashValue } from "@/components/ui";
import type { Evidence } from "@/lib/api";

// === Types

export interface EvidenceItemCardProps {
  item: Evidence;
  downloading: boolean;
  onDownload: (item: Evidence) => void;
}

// === Component

export function EvidenceItemCard({ item, downloading, onDownload }: EvidenceItemCardProps): React.JSX.Element {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-glass p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="violet">{item.kind}</Badge>
        <Badge>{item.object_key ? "File" : "Text"}</Badge>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-ink">{item.content}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-subtle">
          <span>
            {item.submitted_by.slice(0, 10)}… · {new Date(item.created_at).toLocaleString()}
          </span>
          {item.content_sha256 ? (
            <span className="inline-flex items-center gap-1.5">
              sha256
              <HashValue value={item.content_sha256} head={12} tail={6} />
            </span>
          ) : null}
        </div>
        <Button
          variant="secondary"
          size="sm"
          leading={<Download className="size-3.5" />}
          loading={downloading}
          loadingLabel="Downloading…"
          onClick={() => onDownload(item)}
          className="w-full sm:w-fit"
        >
          Download
        </Button>
      </div>
    </li>
  );
}
