import Image from "next/image";
import Link from "next/link";
import { SessionBar } from "./SessionBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4 md:px-12">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <Image
            src="/logo-tr.png"
            alt=""
            width={28}
            height={33}
            className="h-7 w-auto"
            priority
          />
          <Image
            src="/full-logo-tr.png"
            alt="OpenDeal"
            width={160}
            height={56}
            className="h-8 w-auto md:h-9"
            priority
          />
        </Link>
        <nav className="flex gap-5 text-sm text-[var(--ink-muted)]">
          <Link href="/market" className="hover:text-[var(--ink)]">
            Market
          </Link>
          <Link href="/deals/new" className="hover:text-[var(--ink)]">
            New deal
          </Link>
          <Link href="/mediator" className="hover:text-[var(--ink)]">
            Mediator
          </Link>
        </nav>
      </header>
      <main className="flex-1 px-6 py-8 md:px-12">{children}</main>
      <footer className="border-t border-[var(--line)] px-6 py-5 md:px-12">
        <SessionBar />
      </footer>
    </div>
  );
}
