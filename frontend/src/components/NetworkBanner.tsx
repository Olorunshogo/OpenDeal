"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui";
import { getMeta } from "@/lib/api";

function normalizeNetwork(network: string | null | undefined): string {
  return (network ?? "").trim().toLowerCase();
}

function isLiveNetwork(network: string): boolean {
  return network !== "" && network !== "regtest";
}

export function NetworkBanner({ network }: { network?: string | null }) {
  const envNetwork = process.env.NEXT_PUBLIC_BITCOIN_NETWORK ?? null;
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
    staleTime: 60_000,
  });

  const resolved = normalizeNetwork(
    network ?? envNetwork ?? metaQuery.data?.network ?? null,
  );

  if (!isLiveNetwork(resolved)) {
    return null;
  }

  const cap = metaQuery.data?.pilot_max_amount_sats;
  const isMainnet = resolved === "bitcoin" || resolved === "mainnet";

  return (
    <Alert
      tone={isMainnet ? "danger" : "warn"}
      title={
        <>
          Active Bitcoin network: <span className="font-semibold">{resolved}</span>
        </>
      }
    >
      <span className="flex flex-col gap-1">
        <span>
          {isMainnet
            ? "Real funds. Double-check addresses, amounts, and PSBT outputs."
            : "Test coins only. Confirm faucet deposits before verifying funding."}
        </span>
        {cap != null ? <span className="text-xs">Pilot amount cap: {cap.toLocaleString()} sats</span> : null}
      </span>
    </Alert>
  );
}
