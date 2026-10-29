import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden="true" className={cn("block rounded-lg skeleton-shimmer", className)} />;
}
