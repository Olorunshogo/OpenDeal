"use client";

import { FileUp, X } from "lucide-react";
import { useId, useState, type DragEvent } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

// === Types

export interface UploadFieldProps {
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

// === Component

export function UploadField({
  label,
  file,
  onFileChange,
  accept,
  hint,
  error,
  required = false,
  disabled = false,
  className,
}: UploadFieldProps): React.JSX.Element {
  const inputId: string = useId();
  const [dragging, setDragging] = useState<boolean>(false);

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    if (!disabled) {
      onFileChange(event.dataTransfer.files[0] ?? null);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="flex items-center gap-1 text-sm font-medium text-ink">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        className="peer sr-only"
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-glass px-4 py-3 text-sm">
          <FileUp aria-hidden="true" className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
          <span className="shrink-0 text-xs text-ink-subtle">{(file.size / 1024).toFixed(1)} KB</span>
          <IconButton label="Remove file" size="sm" icon={<X className="size-4" />} onClick={() => onFileChange(null)} />
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center text-sm transition-colors peer-focus-visible:border-violet peer-focus-visible:shadow-glow-violet",
            dragging ? "border-brand bg-brand/10" : "border-line-strong bg-glass hover:border-violet/60",
            error && "border-danger",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <FileUp aria-hidden="true" className="size-6 text-violet-soft" />
          <span className="text-ink">
            <span className="font-medium text-brand">Choose a file</span> or drop it here
          </span>
          {accept ? <span className="text-xs text-ink-subtle">{accept}</span> : null}
        </label>
      )}
      {error || hint ? <span className={cn("text-xs", error ? "text-danger" : "text-ink-subtle")}>{error ?? hint}</span> : null}
    </div>
  );
}
