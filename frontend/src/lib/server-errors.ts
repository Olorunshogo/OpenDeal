import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

// === Types

export interface ServerFieldRule<T extends FieldValues> {
  field: FieldPath<T>;
  match: RegExp;
}

// === Helpers

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  rules: ServerFieldRule<T>[],
): boolean {
  const message: string = errorMessage(error, "");
  const rule: ServerFieldRule<T> | undefined = rules.find((candidate) => candidate.match.test(message));
  if (!rule) {
    return false;
  }
  setError(rule.field, { type: "server", message }, { shouldFocus: true });
  return true;
}
