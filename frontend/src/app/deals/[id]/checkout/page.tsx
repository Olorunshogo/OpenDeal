"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { NetworkBanner } from "@/components/NetworkBanner";
import { getDeal, getMeta } from "@/lib/api";

export default function CheckoutPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const dealQuery = useQuery({
    queryKey: ["deal", id],
    queryFn: () => getDeal(id),
    enabled: Boolean(id),
  });
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
  });
  const deal = dealQuery.data;
  const custody = metaQuery.data?.custody ?? deal?.settlement_model ?? "unknown";
  const providerCustody = custody === "provider_custody" || custody === "simulated";

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <NetworkBanner network={deal?.network} />
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)]">Checkout</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {deal?.title ?? "Loading…"}
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          Embeddable deal summary. Custody model:{" "}
          <span className="text-[var(--accent-soft)]">{custody}</span>
          {providerCustody
            ? ". This rail is provider-managed or simulated. It is not 2-of-3 multisig."
            : ". Escrow is 2-of-3 multisig. The API does not hold keys."}
        </p>
        {deal ? (
          <dl className="mt-6 space-y-3 text-sm">
            <div>
              <dt className="text-[var(--ink-muted)]">Amount</dt>
              <dd>{deal.amount_sats.toLocaleString()} sats</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-muted)]">Network</dt>
              <dd>{deal.network}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-muted)]">Status</dt>
              <dd>{deal.status}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink-muted)]">Escrow address</dt>
              <dd className="break-all font-mono text-xs">
                {deal.escrow_address ?? "Not prepared yet. Open the deal and prepare funding."}
              </dd>
            </div>
          </dl>
        ) : null}
        {dealQuery.error ? (
          <p className="mt-4 text-sm text-[var(--danger)]">Could not load this deal.</p>
        ) : null}
      </div>
    </AppShell>
  );
}
