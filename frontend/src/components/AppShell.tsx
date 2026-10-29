import Image from "next/image";
import Link from "next/link";
import { ApiStatusBanner, ApiStatusIndicator } from "./ApiStatusBanner";
import { SessionBar } from "./SessionBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-[var(--line)] px-4 py-4 sm:px-6 lg:px-12">
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
            className="hidden h-8 w-auto sm:block lg:h-9"
            priority
          />
        </Link>
        <nav className="flex items-center gap-4 text-sm text-[var(--ink-muted)] sm:gap-5">
          <Link href="/market" className="hover:text-[var(--ink)]">
            Market
          </Link>
          <Link href="/deals/new" className="hover:text-[var(--ink)]">
            New deal
          </Link>
          <Link href="/mediator" className="hover:text-[var(--ink)]">
            Mediator
          </Link>
          <Link href="/onboarding" className="hover:text-[var(--ink)]">
            Sign in
          </Link>
          <ApiStatusIndicator />
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:px-12">
        <ApiStatusBanner />
        {children}
      </main>
      <footer className="border-t border-[var(--line)] px-4 py-5 sm:px-6 lg:px-12">
        <SessionBar />
      </footer>
    </div>
  );
}
