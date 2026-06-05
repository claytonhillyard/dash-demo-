// src/instrumentation.ts
// Next 15 server-runtime convention — runs once per cold start.
// See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Re-export Sentry's onRequestError so RSC + middleware errors are captured
// automatically (v8.28+ supports this Next 15 hook).
export const onRequestError = Sentry.captureRequestError;
