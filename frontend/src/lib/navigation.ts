/** Only same-site paths are accepted, so `?next=` cannot redirect off-site. */
export function safeNextPath(value: string | null | undefined, fallback = "/deals/new"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : fallback;
}
