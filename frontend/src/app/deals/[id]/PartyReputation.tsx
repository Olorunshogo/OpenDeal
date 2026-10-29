"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui";
import { getReputation } from "@/lib/api";

function ReputationLine({ label, pubkey }: { label: string; pubkey: string }) {
  const reputationQuery = useQuery({
    queryKey: ["reputation", pubkey],
    queryFn: () => getReputation(pubkey),
    enabled: Boolean(pubkey),
  });
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-ink-subtle">{label}:</span>
      {reputationQuery.data ? (
        <span className="text-ink">
          {reputationQuery.data.settled} settled · {reputationQuery.data.disputed} disputed
        </span>
      ) : (
        <Skeleton className="h-3 w-20" />
      )}
    </span>
  );
}

export function PartyReputation({ sellerPubkey, buyerPubkey }: { sellerPubkey: string; buyerPubkey: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <ReputationLine label="Seller history" pubkey={sellerPubkey} />
      <ReputationLine label="Buyer history" pubkey={buyerPubkey} />
    </div>
  );
}
