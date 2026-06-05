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
