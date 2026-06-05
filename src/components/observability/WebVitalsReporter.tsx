"use client";

import { useEffect } from "react";
import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { isDemoMode } from "@/lib/demo/mode";
import { reportWebVital } from "@/lib/observability/webVitals";

/**
 * Mounted once at the root layout (`src/app/layout.tsx`). Registers
 * PerformanceObservers for LCP, INP, and CLS via the `web-vitals` library on
 * mount, then pipes each metric report into Sentry via `reportWebVital()`.
 *
 * Demo-mode short-circuit: skip observer registration ENTIRELY. The
 * `web-vitals` library installs PerformanceObservers, visibilityState
 * listeners, and event-timing buffers even when its callbacks become no-ops —
 * so we don't pay any of that overhead in the demo deploy. Slice 11 §6
 * established the "no observability work in demo" pattern; this preserves it.
 *
 * `window.location.pathname` is read at REPORT TIME (inside the callback),
 * not registration time. This is correctness-critical for soft-navigation:
 * a user who lands on `/` and navigates to `/inventory` before LCP fires
 * gets the LCP tagged with `/inventory`, which is the page the metric
 * actually describes.
 *
 * Returns null — effect-only component, no DOM output.
 */
export function WebVitalsReporter(): null {
  useEffect(() => {
    if (isDemoMode()) return;

    const report = (metric: Metric) =>
      reportWebVital(metric, window.location.pathname);

    onLCP(report);
    onINP(report);
    onCLS(report);
  }, []);

  return null;
}
