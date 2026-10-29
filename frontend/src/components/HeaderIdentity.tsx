"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { clearSession, useHasSigningCapability, useSession } from "@/lib/session";

/** Header slot: "Sign in" when signed out, otherwise the short identity and a sign-out button. */
export function HeaderIdentity() {
  const session = useSession();
  const hasKey = useHasSigningCapability(session?.pubkey);
  const queryClient = useQueryClient();

  if (!session?.token) {
    return (
      <Link href="/onboarding" className="hover:text-[var(--ink)]">
        Sign in
      </Link>
    );
  }
  const short = `${session.pubkey.slice(0, 8)}…`;
  return (
    <span className="inline-flex items-center gap-2">
      <Link
        href="/onboarding"
        title={`${session.pubkey}\n${hasKey ? "Signing key unlocked in this tab" : "Signing key locked: unlock to sign"}`}
        className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-[var(--ink)]"
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${hasKey ? "bg-[var(--ok)]" : "bg-[var(--warn)]"}`}
        />
        {short}
        <span className="sr-only">{hasKey ? "(signing key unlocked)" : "(signing key locked)"}</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          clearSession();
          void queryClient.cancelQueries();
          queryClient.clear();
        }}
        className="text-xs underline decoration-[var(--line)] underline-offset-4 hover:text-[var(--ink)]"
      >
        Sign out
      </button>
    </span>
  );
}
