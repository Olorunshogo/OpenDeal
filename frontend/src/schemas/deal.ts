import { z } from "zod";
import { pubkeyError } from "@/lib/pubkey";
import {
  createBitcoinAddressSchema,
  createOptionalString,
  createRequiredString,
  createSatsAmountSchema,
} from "./generics";

// === Helpers

const utf8: TextEncoder = new TextEncoder();

function withinBytes(max: number): (value: string) => boolean {
  return (value: string) => utf8.encode(value).length <= max;
}

// === New deal

export interface NewDealSchemaOptions {
  network: string;
  pilotMaxAmountSats: number | null;
}

export function createNewDealSchema({ network, pilotMaxAmountSats }: NewDealSchemaOptions) {
  return z
    .object({
      title: createRequiredString({ requiredMessage: "Give the deal a title", max: 256 }).refine(
        withinBytes(256),
        "Title is too long",
      ),
      description: createOptionalString({ max: 10_000 }).refine(withinBytes(10_000), "Description is too long"),
      amountSats: createSatsAmountSchema({ max: pilotMaxAmountSats }),
      manualKeys: z.boolean(),
      buyerPubkey: z.string().trim().min(1, "Choose the buyer"),
      mediatorPubkey: z.string().trim().min(1, "Choose an approved mediator"),
      sellerPayoutAddress: createBitcoinAddressSchema(network, { requiredMessage: "Enter the seller payout address" }),
      buyerRefundAddress: createBitcoinAddressSchema(network, { requiredMessage: "Enter the buyer refund address" }),
    })
    .superRefine((values, context) => {
      if (!values.manualKeys) {
        return;
      }
      for (const field of ["buyerPubkey", "mediatorPubkey"] as const) {
        const message: string | null = values[field] ? pubkeyError(values[field]) : null;
        if (message) {
          context.addIssue({ code: "custom", path: [field], message });
        }
      }
    });
}

export type NewDealValues = z.infer<ReturnType<typeof createNewDealSchema>>;

// === Settlement

export function createSettlementProposalSchema(network: string) {
  return z.object({
    destination: createBitcoinAddressSchema(network, { requiredMessage: "Enter the destination address" }),
    feeSats: createSatsAmountSchema({ min: 200, requiredMessage: "Enter a fee", invalidMessage: "Use a whole number of sats" }),
  });
}

export type SettlementProposalValues = z.infer<ReturnType<typeof createSettlementProposalSchema>>;

// === Evidence

export const evidenceSchema = z.object({
  kind: createRequiredString({ requiredMessage: "Say what kind of evidence this is", max: 64 }),
  content: createRequiredString({ requiredMessage: "Evidence text is required", max: 10_000 }),
});

export type EvidenceValues = z.infer<typeof evidenceSchema>;
