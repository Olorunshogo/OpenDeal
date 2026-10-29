import { z } from "zod";
import { createOptionalString, createRequiredString } from "./generics";

// === Registration

export const mediatorApplicationSchema = z.object({
  displayName: createRequiredString({ requiredMessage: "Enter the name parties will see", max: 80 }),
});

export type MediatorApplicationValues = z.infer<typeof mediatorApplicationSchema>;

// === Dispute resolution

export const disputeResolutionSchema = z.object({
  rationale: createOptionalString({ max: 2000 }),
});

export type DisputeResolutionValues = z.infer<typeof disputeResolutionSchema>;
