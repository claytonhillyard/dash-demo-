// This file configures the initialization of Sentry on the server side.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// All three sentry.*.config.ts files in this repo delegate to the single
// initSentry() helper so the demo-mode guard and scrubbers are defined once.
import { initSentry } from "@/lib/observability/sentry";
initSentry();
