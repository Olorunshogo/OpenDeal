"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { getDeal, getMeta } from "@/lib/api";
import { useSession, type Session } from "@/lib/session";

export function CheckoutClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const session: Session | null = useSession();
  const token: string = session?.token ?? "";
  const dealQuery = useQuery({
    queryKey: ["deal", id, session?.pubkey],
    queryFn: () => getDeal(token, id),
    enabled: Boolean(id && token),
  });
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
  });
  const deal = token ? dealQuery.data : undefined;
  const custody = metaQuery.data?.custody ?? deal?.settlement_model ?? "unknown";
  const providerCustody = custody === "provider_custody" || custody === "simulated";

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <NetworkBanner network={deal?.network} />
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Checkout</p>
          <h1 className="break-words font-[family-name:var(--font-display)] text-3xl sm:text-4xl">
            {token ? (deal?.title ?? "Loading…") : "Sign in to view this checkout"}
          </h1>
        </div>
        {!token ? (
          <p className="text-sm text-[var(--ink-muted)]">
            Only the seller, buyer, or mediator on this deal can open it. Use the footer to sign in.
          </p>
        ) : null}
        <p className="text-sm text-[var(--ink-muted)]">
          Embeddable deal summary. Custody model:{" "}
          <span className="text-[var(--accent-soft)]">{custody}</span>
          {providerCustody
            ? ". This rail is provider-managed or simulated. It is not 2-of-3 multisig."
            : ". Escrow is 2-of-3 multisig. The API does not hold keys."}
        </p>
        {deal ? (
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[var(--ink-muted)]">Amount</dt>
              <dd>{deal.amount_sats.toLocaleString()} sats</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[var(--ink-muted)]">Network</dt>
              <dd>{deal.network}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[var(--ink-muted)]">Status</dt>
              <dd>{deal.status}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[var(--ink-muted)]">Escrow address</dt>
              <dd className="break-all font-mono text-xs">
                {deal.escrow_address ?? "Not prepared yet. Open the deal and prepare funding."}
              </dd>
            </div>
          </dl>
        ) : null}
        {dealQuery.error ? (
          <p className="text-sm text-[var(--danger)]">
            {dealQuery.error instanceof Error ? dealQuery.error.message : "Could not load this deal."}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
