import Image from "next/image";
import Link from "next/link";
import { SessionBar } from "@/components/SessionBar";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5 md:px-12">
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
          <Link href="/deals/new" className="hover:text-[var(--ink)]">
            New deal
          </Link>
          <Link href="/mediator" className="hover:text-[var(--ink)]">
            Mediator
          </Link>
        </nav>
      </header>

      <main className="relative flex flex-1 flex-col justify-end px-6 pb-16 pt-10 md:px-12 md:pb-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgba(242,239,230,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(242,239,230,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "linear-gradient(to bottom, black 20%, transparent 85%)",
          }}
        />

        <div className="relative z-10 max-w-3xl">
          <p className="animate-rise network-badge mb-4 text-xs uppercase tracking-[0.2em] text-[var(--accent-soft)]">
            Bitcoin coordination · regtest experimental
          </p>
          <h1 className="animate-rise">
            <Image
              src="/full-logo-tr.png"
              alt="OpenDeal"
              width={365}
              height={129}
              className="h-auto w-full max-w-md md:max-w-xl"
              priority
            />
          </h1>
          <p className="animate-rise-delay mt-5 max-w-xl text-lg leading-relaxed text-[var(--ink-muted)] md:text-xl">
            Signed deal agreements. 2-of-3 multisig escrow. The API never holds your keys.
          </p>
          <div className="animate-rise-delay mt-8 flex flex-wrap gap-3">
            <Link
              href="/deals/new"
              className="rounded bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--bg-deep)] transition hover:bg-[var(--accent-soft)]"
            >
              Start a deal
            </Link>
            <Link
              href="/mediator"
              className="rounded border border-[var(--line)] px-5 py-3 text-sm text-[var(--ink)] transition hover:border-[var(--accent)]"
            >
              Mediator desk
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--line)] px-6 py-6 md:px-12">
        <SessionBar />
      </footer>
    </div>
  );
}
