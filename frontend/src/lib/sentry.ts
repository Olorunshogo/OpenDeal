import * as Sentry from "@sentry/browser";

let initialized = false;

export function initBrowserSentry(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
  });
  initialized = true;
}
