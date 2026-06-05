// This file configures Sentry for the Next.js Edge runtime
// (middleware, route handlers on `runtime: "edge"`).
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import { initSentry } from "@/lib/observability/sentry";
initSentry();
