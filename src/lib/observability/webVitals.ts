import * as Sentry from "@sentry/nextjs";
import type { Metric } from "web-vitals";

/**
 * Translate a `web-vitals` Metric into a Sentry `captureMessage` event.
 *
 * - `tags` carry the three filterable axes: which metric, what rating bucket,
 *   what route. Tag values are coerced to strings by Sentry, which is the
 *   right shape for low-cardinality enums.
 * - `extra` carries the metric value and metadata as primitives. Numeric
 *   floats (millisecond LCP, fractional CLS) belong in extras, not tags.
 * - `entries` (the PerformanceEntry[] field on Metric) is INTENTIONALLY NOT
 *   forwarded. It contains DOM node references and detailed timing data we
 *   don't need for triage; forwarding it would (a) bloat every event, and
 *   (b) potentially leak DOM contents into the observability pipeline.
 *   The scrubber-by-omission is load-bearing for the slice 12 §7.2 invariant.
 * - Rating is forwarded VERBATIM from `metric.rating` — we do NOT re-derive
 *   from `metric.value`. The `web-vitals` library is the canonical source of
 *   truth for good/needs-improvement/poor thresholds (LCP ≤ 2500ms etc.); a
 *   re-derivation would silently drift if Google updates a threshold in a
 *   future patch release.
 * - NO `orgId` field anywhere. Vitals are platform-level rendering signals;
 *   the meaningful triage axis is the route, not the tenant. Slice 11 §5
 *   tenancy invariant preserved by not introducing the leak in the first
 *   place (the slice-11 `beforeSend` scrubber is the defense-in-depth backstop).
 */
export function reportWebVital(metric: Metric, route: string): void {
  Sentry.captureMessage(`web-vital ${metric.name}`, {
    level: "info",
    tags: {
      metric: metric.name,
      rating: metric.rating,
      route,
    },
    extra: {
      value: metric.value,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    },
  });
}
