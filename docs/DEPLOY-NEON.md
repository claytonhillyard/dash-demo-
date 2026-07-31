# Deploying with a real Neon database (persistent, non-demo)

The app runs three ways:

| Mode | `DATABASE_URL` | Driver | Data |
|---|---|---|---|
| **Demo** (public Netlify) | unset | pglite (in-memory) | authored seed, resets each cold start |
| **Desktop** (D-2) | unset | pglite (persisted to `PGLITE_DATA_DIR`) | local, per-machine |
| **Persistent** (this doc) | **set** to a Neon URL | **neon-serverless** (WebSocket) | your real Neon Postgres |

C-8 switched the persistent path from `neon-http` (which throws on `db.transaction()`) to **`neon-serverless`**, so transactions — `recordPayment`'s overpay guard and every slice-35b confirmed write — now work against Neon. **This path cannot be exercised in CI or locally without a real Neon URL**, so the checks below are the acceptance test for the persistent deployment.

---

## One-time setup

1. **Create a Neon project + a branch** (use a throwaway branch first, not production). Copy its pooled connection string — it looks like `postgresql://USER:PASS@ep-xxx-pooler.REGION.aws.neon.tech/DB?sslmode=require`.
2. **Apply the migrations offline** (they do NOT run at request time on Neon — only pglite self-migrates):
   ```bash
   DATABASE_URL='postgresql://…' npm run db:migrate
   ```
   This applies everything in `drizzle/` (through `0023_dry_sabra`) to the Neon branch.
3. **Set the Netlify env vars** (Site config → Environment variables), then redeploy:
   - `DATABASE_URL` = the Neon pooled string.
   - `SESSION_SECRET` = a long random string (required once you're out of demo mode — auth is real now).
   - Leave `NEXT_PUBLIC_DEMO_MODE` **unset** (demo mode short-circuits the DB entirely; setting it would ignore Neon).
   - Optional, to go fully live: `AI_GATEWAY_API_KEY` (real AI drafting/narratives/command routing), `RESEND_API_KEY` + `EMAIL_FROM` (real email sends).
4. Node version: Netlify is pinned to Node 20 (`netlify.toml`). neon-serverless needs a WebSocket constructor there; the app supplies it via the `ws` package (`src/db/client.ts` sets `neonConfig.webSocketConstructor = ws` when no native `WebSocket` exists). Nothing to configure — but if you bump `NODE_VERSION` to 22+, the native WebSocket is used automatically and `ws` becomes a no-op.

## Acceptance smoke-test (run against the deployed persistent site)

Sign in (real auth — your seeded user), then:

1. **Transactions work (the core C-8 fix).** Create a customer → create an invoice → issue it → **record a payment**. It must succeed. On the *old* neon-http driver this returned "Server error" (transaction threw); success here proves neon-serverless transactions are live.
2. **Overpay guard.** On that issued invoice, try to record a payment **larger than the remaining balance**. Expect the friendly "Payment exceeds the remaining balance ($X left)" — not a 500. (The `FOR UPDATE` row lock added in C-8 also serializes two people recording against the same invoice at once; a single operator won't hit that, but it's now correct if you ever do.)
3. **35b confirmed writes.** Open `/command`, type "record a $50 payment on <that invoice number>", Confirm on the card. It must complete (same transactional path).
4. **Data persists across a redeploy.** Trigger a redeploy (or wait for a cold start) and confirm the customer/invoice/payment you created are still there — proving you're on Neon, not the ephemeral pglite.
5. **No secrets in logs.** Skim the Netlify function logs for the run above — the connection string must never appear (it's only read from `process.env`, never logged).

If step 1 fails with a WebSocket/connection error, double-check: the connection string is the **pooled** endpoint, `sslmode=require` is present, and `DATABASE_URL` is set on the exact deploy context you're testing (production vs. preview).

## Rollback

If anything misbehaves, unset `DATABASE_URL` (and set `NEXT_PUBLIC_DEMO_MODE=true`) and redeploy — you're back to the safe demo build instantly. No data migration needed either direction; the Neon branch is untouched by a rollback.
