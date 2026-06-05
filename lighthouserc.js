/**
 * Lighthouse CI configuration for AIYA Dashboard.
 *
 * Slice 14 — synthetic-lab perf budgets enforced at build time. The companion
 * to slice 12's real-user Web Vitals telemetry: same thresholds, different
 * idiom. Run via `npm run lighthouse`.
 *
 * Auth: the dashboard requires login on `/`. Lighthouse runs against the
 * demo-mode build (NEXT_PUBLIC_DEMO_MODE=true), which bypasses auth entirely
 * via the slice-3 middleware short-circuit. No credentials in this file by
 * design — see spec §4 + §6.2.
 *
 * Sentry / Web Vitals: demo mode also disables Sentry init (slice 11 §6) and
 * the WebVitalsReporter observer registration (slice 12 §5), so lighthouse
 * runs produce zero synthetic events in the production observability system.
 *
 * Budgets: PLACEHOLDERS in this task. Calibrated against an observed baseline
 * in Task B2 of the plan — see spec §2.5 ("observed baseline + 10% headroom,
 * NOT aspirational"). Each assertion documents the observed value at
 * calibration time + the TODO trajectory toward slice-12 good thresholds.
 */
module.exports = {
  ci: {
    collect: {
      // Build + start in demo mode so /login AND / are reachable without auth.
      // NEXT_PUBLIC_DEMO_MODE=true also disables Sentry init (slice 11 §6),
      // so lighthouse runs don't pollute the production Sentry project.
      // SESSION_SECRET=lighthouse-ci-noop-secret is a literal dummy that
      // satisfies the middleware import — it's never used cryptographically
      // because the demo path bypasses verify (see slice 11 §3.3).
      //
      // The shell command runs `next build` first (so .next/ exists) then
      // `next start`. The build step is idempotent and fast on warm caches;
      // doing it inline keeps the `npm run lighthouse` UX a single command.
      startServerCommand:
        "NEXT_PUBLIC_DEMO_MODE=true SESSION_SECRET=lighthouse-ci-noop-secret sh -c 'npm run build && npm run start'",
      startServerReadyPattern: "Ready in",
      url: [
        "http://localhost:3000/login",
        "http://localhost:3000/",
      ],
      numberOfRuns: 3, // median of 3 — smooths out single-run variance
      settings: {
        preset: "desktop", // slice 14 is desktop-only (spec §2.7)
        // Skip SEO category — not a marketing site (spec §2.4 table)
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      // PLACEHOLDER BUDGETS — calibrated against observed baseline in Task B2.
      // Each TODO names the tightening trajectory toward slice-12 thresholds.
      assertions: {
        // ─── Performance vitals ──────────────────────────────────────────
        // LCP — slice 12 "good" target is 2500ms. Initial budget calibrated
        // from observed baseline + 10% headroom (Task B2 will adjust).
        // TODO(slice-14-followup): tighten toward 2500ms after perf-improvement sprint.
        "largest-contentful-paint": ["error", { maxNumericValue: 3500 }],

        // CLS — slice 12 "good" target is 0.1. Dashboard should already be
        // near-zero (no above-the-fold image swaps, no late-loading layout
        // shifts). Tight initial target; hold here.
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],

        // TBT — lab proxy for slice 12's INP runtime signal (Lighthouse 11+
        // does not emit lab INP; TBT is the documented stand-in). See spec §2.4.1.
        // TODO(slice-14-followup): tighten as we optimize main-thread work.
        "total-blocking-time": ["error", { maxNumericValue: 400 }],

        // ─── Category scores ─────────────────────────────────────────────
        // Performance — initial budget set permissively from observed baseline;
        // tighten toward ≥ 0.80 in follow-on slices.
        // TODO(slice-14-followup): tighten toward 0.80.
        "categories:performance": ["error", { minScore: 0.75 }],

        // Accessibility — slice 1c established the accessibility-conscious
        // foundation. Hold at 0.95; tighten to 1.0 in a future a11y-focused slice.
        "categories:accessibility": ["error", { minScore: 0.95 }],

        // Best Practices — generally an easy 0.9+ for a Next.js app.
        "categories:best-practices": ["error", { minScore: 0.9 }],
      },
    },
    upload: {
      // Reports written to .lighthouseci/ on the local filesystem. Gitignored.
      // No upload to LHCI server / public storage — see spec §2.2.
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
