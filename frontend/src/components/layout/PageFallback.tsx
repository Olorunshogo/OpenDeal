import { Skeleton } from "@/components/ui/Skeleton";

export function PageFallback({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label={label}
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-12"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-2/3 sm:w-1/2" />
      <Skeleton className="h-4 w-full sm:w-3/4" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
