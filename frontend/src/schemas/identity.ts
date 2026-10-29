import { z } from "zod";
import { MIN_PASSPHRASE_LENGTH } from "@/lib/identity-vault";
import { createPassphraseSchema } from "./generics";

// === Unlock

export const unlockSchema = z.object({
  passphrase: createPassphraseSchema({ min: MIN_PASSPHRASE_LENGTH }),
});

export type UnlockValues = z.infer<typeof unlockSchema>;

// === Restore

export const restoreSchema = z.object({
  candidateIndex: z.string(),
  passphrase: createPassphraseSchema({ min: MIN_PASSPHRASE_LENGTH }),
  keepOnDevice: z.boolean(),
});

export type RestoreValues = z.infer<typeof restoreSchema>;

// === Create

export const createIdentitySchema = z
  .object({
    passphrase: createPassphraseSchema({ min: MIN_PASSPHRASE_LENGTH }),
    confirmPassphrase: z.string().min(1, "Repeat your passphrase"),
    keepOnDevice: z.boolean(),
  })
  .refine((values) => values.passphrase === values.confirmPassphrase, {
    path: ["confirmPassphrase"],
    message: "Passphrases do not match",
  });

export type CreateIdentityValues = z.infer<typeof createIdentitySchema>;
