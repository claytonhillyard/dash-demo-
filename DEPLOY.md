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
