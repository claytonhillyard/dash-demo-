# Deploying AIYA Dashboard

This is a server-rendered Next.js app (auth middleware, server actions, route
handlers, server-side reads). It is NOT a static export.

## Netlify — public demo (simulation mode)

The demo runs with no secrets and no database.

1. Connect this repo to a new Netlify site (it auto-detects `netlify.toml` and
   the `@netlify/plugin-nextjs` runtime).
2. Set environment variables:
   - `NEXT_PUBLIC_DEMO_MODE=true`
   - `SESSION_SECRET=<any long random string>` (the middleware import reads it even
     though demo bypasses auth)
   - Do **not** set `DATABASE_URL` or any API keys — demo seeds data and uses the
     simulated market feed.
3. Deploy. The dashboard is open (no login), every panel is populated with seeded
   "simulated" data, and writes are disabled with an on-screen notice.

## Netlify — real app (not the demo)

Leave `NEXT_PUBLIC_DEMO_MODE` unset and instead set `DATABASE_URL` (Neon Postgres),
`SESSION_SECRET`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, and the market API keys
(`TWELVEDATA_API_KEY`, etc.). Run `npm run db:migrate` against the Neon database
once before first use.

## Sentry setup (optional, real-app only)

Slice 11 wired the app to `@sentry/nextjs` for backend error capture (action
wrappers, middleware, client-side poll-failure tracking). **The SDK is a no-op
when `SENTRY_DSN` is unset — both demo and bare real-app deploys work fine
without it.** Wire it up when you want operator-side observability.

1. **Create a Sentry account + project.** Free tier covers a solo build like
   this one — go to https://sentry.io and create a new "Next.js" project. Note
   the DSN (looks like `https://abc123@o4501234567890.ingest.sentry.io/12345`).
2. **Set `SENTRY_DSN` on your Netlify/Vercel production environment.** Demo
   deploys should leave it unset.
3. **Optional: source map upload.** For unminified stack traces in Sentry,
   create a Sentry auth token (Settings → Account → API → Auth Tokens, scopes:
   `project:releases`, `project:write`) and set:
   - `SENTRY_AUTH_TOKEN=<token>`
   - `SENTRY_ORG=<your-org-slug>`
   - `SENTRY_PROJECT=<your-project-slug>`

   If these are unset the build still succeeds — `withSentryConfig` just skips
   the upload step. Stack traces in Sentry will reference minified lines until
   you wire it up.
4. **Verify capture.** After deploy, trigger a server-side error (e.g. log in
   with bad credentials repeatedly, or hit a server action that throws under
   load). The error should appear in the Sentry Issues view within ~30 seconds.
5. **What's captured + what isn't.**
   - Captured: server-action exceptions (with `orgId` tag for triage),
     middleware exceptions, client-side polling failures (after 5 consecutive
     failures over ~75s).
   - NOT captured: anything in demo mode (the SDK init no-ops); orgId in
     breadcrumbs (server-side `event.tags` only — never in user-visible
     breadcrumb chains).
6. **CSP note.** When `SENTRY_DSN` is set at build time, `next.config.mjs`
   automatically widens the `connect-src` Content-Security-Policy header to
   include exactly your Sentry ingest host (e.g. `o4501234567890.ingest.sentry.io`).
   Demo builds keep the tighter slice-3 CSP — no widening when DSN is unset.

## Lighthouse CI (optional, local-only for now)

Slice 14 wired the app to `@lhci/cli` for synthetic-lab perf budgets at
build time. Pairs with slice 12's real-user Web Vitals telemetry: same
thresholds (LCP / CLS / TBT), different idiom. Run on your laptop before
shipping a perf-touching change to make sure you haven't regressed
budgets that the live deploy would silently inherit.

1. **Run lighthouse locally.**
   ```bash
   npm run lighthouse
   ```
   This will: build the app, start it in demo mode (no auth, no Sentry,
   no DB), audit `/login` and `/` three times each in the desktop preset,
   compute median scores, and assert against the budgets in
   `lighthouserc.js`. Total runtime: 3–5 minutes.

2. **First-run calibration (one-time).** The committed budgets in
   `lighthouserc.js` are **plan-default placeholders**, not yet calibrated
   against your specific hardware. The slice-14 implementation could not
   run Chrome to do the calibration (macOS sandbox restrictions in some
   environments). YOUR first local run is where calibration happens:
   - Run `npm run lighthouse` once
   - If it PASSES at the placeholders, you're golden — keep them
   - If it FAILS, check the actual observed values in
     `.lighthouseci/lhr-*.report.json` (search for `numericValue`)
   - Update `lighthouserc.js` with each failing budget set to
     `observed × 1.1` (rounded up to a sensible number). **EXCEPTION:
     CLS should hold at 0.1 — if observed CLS exceeds that, STOP and
     fix the layout-shift bug rather than widen the budget**
   - Commit the calibrated budgets with a `chore(perf): calibrate
     lighthouse budgets from first local run` message

3. **Interpret a passing run.** Exit code `0` means every budget passed.
   Reports are written to `.lighthouseci/` (gitignored). Open
   `.lighthouseci/lhr-<timestamp>-<url>.report.html` in a browser for the
   full Lighthouse UI with waterfall charts + opportunity recommendations.

4. **Interpret a failing run (after calibration).** Exit code `1` + a
   console summary of which assertion(s) failed. After calibration is
   committed, a failing run usually means:
   - A real regression — fix the cause, don't widen the budget
   - A flaky run on a noisy machine — re-run, take median of two

5. **Calibration philosophy.** Budgets are NOT aspirational targets.
   They're set at observed baseline × 1.1 headroom (with CLS pinned at
   the slice-12 "good" ceiling of 0.1 regardless). This avoids the
   "every build fails forever" anti-pattern when the dashboard's actual
   perf hasn't yet reached aspirational targets. Tighten the budgets
   toward the `TODO(slice-14-followup)` trajectories as the dashboard
   gets faster — that's how the gate stays honest.

6. **What's NOT in this slice (named for future slices).**
   - GitHub Actions integration → slice 14b "Lighthouse CI in CI"
   - Mobile-preset audits → future ("desktop-only" was a deliberate
     scope cut)
   - Per-page budgets for `/inventory` / `/diamonds` / `/deals` /
     `/website` / `/deals` admin → future
   - LHCI server upload + historical trend dashboards → future
     ("filesystem" upload target only; no token needed)

7. **Demo-mode auth bypass note.** The `lighthouserc.js`
   `startServerCommand` sets `NEXT_PUBLIC_DEMO_MODE=true` so lighthouse
   can reach `/` without auth. It also sets a literal dummy
   `SESSION_SECRET=lighthouse-ci-noop-secret` to satisfy the middleware's
   import-time read — demo mode bypasses the cryptographic verify path so
   this dummy is never used. No real credentials in the config by design.
