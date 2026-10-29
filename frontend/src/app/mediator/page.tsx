"use client";

import { Scale } from "lucide-react";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { MediatorRegistryPanel } from "@/components/MediatorRegistryPanel";
import { Alert, ButtonLink, EmptyState } from "@/components/ui";
import type { OpenDisputeSummary } from "@/lib/api";
import { useSession, type Session } from "@/lib/session";
import { DisputeDetailPanel } from "./DisputeDetailPanel";
import { DisputeList } from "./DisputeList";

export default function MediatorPage() {
  const session: Session | null = useSession();
  const token: string = session?.token ?? "";
  const viewer: string | undefined = session?.pubkey;
  const detailRef = useRef<HTMLDivElement>(null);
  const [selectedForIdentity, setSelectedForIdentity] = useState<{
    dispute: OpenDisputeSummary;
    pubkey: string;
  } | null>(null);
  const selected: OpenDisputeSummary | null =
    selectedForIdentity && selectedForIdentity.pubkey === session?.pubkey ? selectedForIdentity.dispute : null;

  function onSelectDispute(dispute: OpenDisputeSummary) {
    setSelectedForIdentity({ dispute, pubkey: session?.pubkey ?? "" });
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 animate-rise">
        <PageHeader
          eyebrow="Mediator"
          title="Dispute desk"
          description="A mediator decision updates protocol state and recommended payout. It does not move Bitcoin alone. 2-of-3 signatures are still required for multisig settlement."
        />

        <MediatorRegistryPanel />
        {!token ? (
          <Alert
            tone="warn"
            title={session ? "Your sign-in expired" : "Sign in as a mediator first"}
            action={
              session ? null : (
                <ButtonLink href="/onboarding?next=/mediator" size="sm">
                  Sign in
                </ButtonLink>
              )
            }
          >
            {session ? "Use Sign in again in the footer." : "Mediators see the disputes assigned to their identity."}
          </Alert>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <DisputeList token={token} viewer={viewer} selectedId={selected?.id ?? null} onSelect={onSelectDispute} />
            <div ref={detailRef} className="min-w-0 scroll-mt-24">
              {selected ? (
                <DisputeDetailPanel key={selected.id} token={token} viewer={viewer} dispute={selected} />
              ) : (
                <EmptyState
                  icon={<Scale className="size-5" />}
                  title="Pick a dispute from the list"
                  description="Its reason, evidence and deal history appear here."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
