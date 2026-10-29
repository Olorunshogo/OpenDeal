import { z } from "zod";
import { bitcoinAddressError } from "@/lib/bitcoin-address";
import { pubkeyError } from "@/lib/pubkey";

// === Options

export interface FieldSchemaOptions {
  requiredMessage?: string;
  invalidMessage?: string;
}

export interface StringSchemaOptions extends FieldSchemaOptions {
  min?: number;
  max?: number;
}

export interface SatsSchemaOptions extends FieldSchemaOptions {
  min?: number;
  max?: number | null;
}

// === Strings

export function createRequiredString(options: StringSchemaOptions = {}): z.ZodString {
  const { requiredMessage = "This field is required", min = 1, max = 500 } = options;
  return z
    .string()
    .trim()
    .min(min, min > 1 ? `Use at least ${min} characters` : requiredMessage)
    .max(max, `Use at most ${max} characters`);
}

export function createOptionalString(options: StringSchemaOptions = {}): z.ZodString {
  const { max = 500 } = options;
  return z.string().trim().max(max, `Use at most ${max} characters`);
}

// === Bitcoin

export function createSatsAmountSchema(options: SatsSchemaOptions = {}) {
  const {
    requiredMessage = "Enter an amount in sats",
    invalidMessage = "Use a whole number of sats",
    min = 1,
    max = null,
  } = options;
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .regex(/^\d+$/, invalidMessage)
    .refine((value) => Number(value) >= min, `Minimum is ${min.toLocaleString()} sats`)
    .refine((value) => max === null || Number(value) <= max, `Maximum is ${(max ?? 0).toLocaleString()} sats`);
}

export function createPubkeySchema(options: FieldSchemaOptions = {}) {
  const { requiredMessage = "Enter a public key" } = options;
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .superRefine((value, context) => {
      const message: string | null = pubkeyError(value);
      if (message) {
        context.addIssue({ code: "custom", message: options.invalidMessage ?? message });
      }
    });
}

export function createBitcoinAddressSchema(network: string, options: FieldSchemaOptions = {}) {
  const { requiredMessage = "Enter a Bitcoin address" } = options;
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .superRefine((value, context) => {
      const message: string | null = bitcoinAddressError(value, network);
      if (message) {
        context.addIssue({ code: "custom", message: options.invalidMessage ?? message });
      }
    });
}

// === Identity

export function createPassphraseSchema(options: StringSchemaOptions = {}): z.ZodString {
  const { requiredMessage = "Enter your passphrase", min = 12 } = options;
  return z
    .string()
    .min(1, requiredMessage)
    .min(min, `Use at least ${min} characters`);
}

// === Web

export function createHttpsUrlSchema(options: FieldSchemaOptions = {}) {
  const { requiredMessage = "Enter a URL", invalidMessage = "Use a full https:// URL" } = options;
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, invalidMessage);
}
