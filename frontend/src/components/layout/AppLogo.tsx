import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <Link href="/" aria-label="OpenDeal home" className={cn("inline-flex shrink-0 items-center", className)}>
      <Image
        src="/full-opendeal-logo-tr.png"
        alt="OpenDeal"
        width={900}
        height={220}
        className="h-9 w-auto sm:h-10"
        priority
      />
    </Link>
  );
}
