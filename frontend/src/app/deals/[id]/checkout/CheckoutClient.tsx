"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { NetworkBanner } from "@/components/NetworkBanner";
import {
  Alert,
  Amount,
  Badge,
  ButtonLink,
  Card,
  DataList,
  HashValue,
  Skeleton,
  StatusBadge,
} from "@/components/ui";
import { getDeal, getMeta } from "@/lib/api";
import { errorMessage } from "@/lib/server-errors";
import { useSession, type Session } from "@/lib/session";

export function CheckoutClient() {
  const params = useParams<{ id: string }>();
  const id: string = params.id;
  const session: Session | null = useSession();
  const token: string = session?.token ?? "";
  const dealQuery = useQuery({
    queryKey: ["deal", id, session?.pubkey],
    queryFn: () => getDeal(token, id),
    enabled: Boolean(id && token),
  });
  const metaQuery = useQuery({ queryKey: ["meta"], queryFn: getMeta });
  const deal = token ? dealQuery.data : undefined;
  const custody: string = metaQuery.data?.custody ?? deal?.settlement_model ?? "unknown";
  const providerCustody: boolean = custody === "provider_custody" || custody === "simulated";

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 animate-rise">
        <NetworkBanner network={deal?.network} />
        <PageHeader
          eyebrow="Checkout"
          title={token ? (deal?.title ?? "Loading…") : "Sign in to view this checkout"}
          description={
            token ? null : "Only the seller, buyer, or mediator on this deal can open it. Use the footer to sign in."
          }
        />
        <Alert
          tone={providerCustody ? "warn" : "info"}
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              Custody model <Badge tone="violet">{custody}</Badge>
            </span>
          }
        >
          {providerCustody
            ? "This rail is provider-managed or simulated. It is not 2-of-3 multisig."
            : "Escrow is 2-of-3 multisig. The API does not hold keys."}
        </Alert>

        {token && dealQuery.isPending ? <Skeleton className="h-48 w-full rounded-2xl" /> : null}

        {deal ? (
          <Card tone="brand">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Amount sats={deal.amount_sats} size="lg" />
              <StatusBadge status={deal.status} />
            </div>
            <DataList
              columns={1}
              items={[
                { label: "Network", value: <Badge>{deal.network}</Badge> },
                {
                  label: "Escrow address",
                  value: deal.escrow_address ? (
                    <HashValue value={deal.escrow_address} full />
                  ) : (
                    <span className="text-ink-muted">Not prepared yet. Open the deal and prepare funding.</span>
                  ),
                },
              ]}
            />
            <div className="flex flex-col gap-3 border-t border-brand/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
                <ShieldCheck aria-hidden="true" className="size-4 text-ok" />
                Two of three keys must sign to move funds.
              </span>
              <ButtonLink href={`/deals/${id}`} size="sm" trailing={<ArrowRight className="size-4" />}>
                Open deal
              </ButtonLink>
            </div>
          </Card>
        ) : null}
        {dealQuery.error ? (
          <Alert tone="danger">{errorMessage(dealQuery.error, "Could not load this deal.")}</Alert>
        ) : null}
      </div>
    </AppShell>
  );
}
