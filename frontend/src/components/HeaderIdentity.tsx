"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button, ButtonLink } from "@/components/ui";
import { clearSession, useHasSigningCapability, useSession } from "@/lib/session";

/** Header slot: "Sign in" when signed out, otherwise the short identity and a sign-out button. */
export function HeaderIdentity() {
  const session = useSession();
  const hasKey = useHasSigningCapability(session?.pubkey);
  const queryClient = useQueryClient();

  if (!session?.token) {
    return (
      <ButtonLink href="/onboarding" size="sm" variant="secondary">
        Sign in
      </ButtonLink>
    );
  }
  const short = `${session.pubkey.slice(0, 8)}…`;
  return (
    <span className="inline-flex items-center gap-2">
      <Link
        href="/onboarding"
        title={`${session.pubkey}\n${hasKey ? "Signing key unlocked in this tab" : "Signing key locked: unlock to sign"}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-glass px-3 py-1 font-mono text-xs text-ink hover:border-violet/60"
      >
        <span aria-hidden className={`size-2 rounded-full ${hasKey ? "bg-ok" : "bg-warn"}`} />
        {short}
        <span className="sr-only">{hasKey ? "(signing key unlocked)" : "(signing key locked)"}</span>
      </Link>
      <Button
        variant="link"
        size="sm"
        className="text-xs"
        onClick={() => {
          clearSession();
          void queryClient.cancelQueries();
          queryClient.clear();
        }}
      >
        Sign out
      </Button>
    </span>
  );
}
