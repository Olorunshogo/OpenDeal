import { z } from "zod";
import { createHttpsUrlSchema } from "./generics";

export const webhookSchema = z.object({
  url: createHttpsUrlSchema(),
});

export type WebhookValues = z.infer<typeof webhookSchema>;
