"use client";

import { useQuery } from "@tanstack/react-query";
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
    <div
      role="status"
      className={`flex flex-col gap-1 rounded border px-3 py-2 text-sm ${
        isMainnet
          ? "border-[var(--danger)]/60 bg-[var(--danger)]/10 text-[var(--danger)]"
          : "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--ink)]"
      }`}
    >
      <p>
        Active Bitcoin network: <span className="font-semibold">{resolved}</span>
        {isMainnet
          ? ". Real funds. Double-check addresses, amounts, and PSBT outputs."
          : ". Test coins only. Confirm faucet deposits before verifying funding."}
      </p>
      {cap != null ? (
        <p className="text-xs opacity-80">
          Pilot amount cap: {cap.toLocaleString()} sats
        </p>
      ) : null}
    </div>
  );
}
