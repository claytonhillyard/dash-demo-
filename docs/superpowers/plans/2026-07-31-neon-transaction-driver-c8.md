# Slice C-8 — Neon Transaction Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make DB transactions work on the production (Neon) path so `recordPayment` and the slice-35b confirms stop failing closed, and make the overpay guard correct under real concurrency. Swap `drizzle-orm/neon-http` → `neon-serverless` (real transactions over WebSocket) and add `SELECT … FOR UPDATE` to the overpay guard.

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-c8-neon-driver`

## ⚠️ Verification reality (read first)

The Neon path is ONLY exercised when `DATABASE_URL` is set — which it is NOT in this environment (tests/dev/desktop all use pglite). So:
- **What we CAN verify headlessly:** the pglite path is byte-for-byte unchanged (the full suite runs on pglite — green = the local path is intact); `tsc` (the driver type swap compiles + every `db: Db` consumer still typechecks); `next build` (ws + neon-serverless bundle without error); the `FOR UPDATE` change's behavior on pglite (pglite supports `SELECT … FOR UPDATE`; existing overpay tests + a new one).
- **What CANNOT be verified here (needs the user's real Neon deploy):** that neon-serverless actually connects over WebSocket on Netlify functions and that `db.transaction()` succeeds against real Neon. That's the deploy smoke-test in `docs/DEPLOY-NEON.md` (controller writes it).

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; NO detached full-suite runs by subagents; a silent exit-1 may be the flapping host sandbox — retry.

---

## Task C8-1 — Driver swap + FOR UPDATE

**Reference:** current `src/db/client.ts` uses `drizzle-orm/neon-http` + `neon(url)`. `@neondatabase/serverless@1.1.0` is already a dep (provides `Pool` + `neonConfig` too). Netlify pins Node 20 (netlify.toml) → NO global `WebSocket` → neon-serverless needs a `ws` constructor.

**Files:**
1. `package.json`: `npm install ws --save` + `npm install @types/ws --save-dev` (report resolved versions; `ws` is a small pure-JS Node package).
2. `src/db/client.ts`:
   - `import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";`
   - `import { Pool, neonConfig } from "@neondatabase/serverless";`
   - `import ws from "ws";`
   - At module load (once): `if (!(globalThis as { WebSocket?: unknown }).WebSocket) { neonConfig.webSocketConstructor = ws; }` — sets the ctor on Node 20; a no-op if a native `WebSocket` exists (Node 22+/edge). Comment it.
   - In `getDb()`'s `DATABASE_URL` branch: `singleton = drizzleNeon(new Pool({ connectionString: url }), { schema });` (was `drizzleNeon(neon(url), …)`).
   - Update the `Db` type union's first arm to the neon-serverless drizzle return type. `tsc` is the proof the union still satisfies every consumer — the neon-serverless drizzle type carries `.transaction()` (the point), and so does the pglite arm, so `db.transaction(...)` on the union stays valid.
   - Keep `ensureDbReady`/`createTestDb`/pglite paths EXACTLY as-is (the local path must not change — the whole suite depends on it).
   - Add a comment block: neon-serverless (WebSocket) replaces neon-http because the latter throws on `transaction()`; the ws ctor is required on Node < 22; migrations still run offline via `npm run db:migrate` on Neon.
3. `src/lib/payments/actions.ts` — `recordPayment`: the overpay guard currently loads the invoice OUTSIDE the transaction and re-reads `SUM(payments)` inside. Add a row lock INSIDE the `db.transaction()`: before the SUM, `SELECT id FROM invoices WHERE id = ? AND org_id = ? FOR UPDATE` (drizzle `.for("update")`) so concurrent recorders on the same invoice serialize on real Postgres. On pglite this is valid and behavior-preserving. Read the current transaction body and insert the lock as the first statement inside it; keep the existing SUM/insert logic. Update the honest-scope comment (added in slice 29) to say the guard now DOES serialize on server Postgres via the row lock.

**Tests:**
- `src/db/client.ts` has no direct unit test for the Neon branch (can't — no URL). Do NOT try to test the Neon branch. The pglite branch is covered by the entire suite.
- `src/lib/payments/actions.ts`: the existing overpay tests must stay green (they run on pglite and exercise the transaction + FOR UPDATE). Add ONE test to `test/lib/payments/actions.test.ts` asserting the exact-boundary overpay still behaves (payment == remaining ok; +1 rejected) — proving the FOR UPDATE addition didn't change the guard's outcome. (A true concurrency race can't be deterministically forced on pglite's single writer; the lock's correctness on real Postgres is a deploy-smoke-test item — note it.)

**Verify (subagent):** `npx vitest run test/lib/payments/actions.test.ts test/db/` (payments + all db tests — the db layer is what the driver swap touches) + `npx tsc --noEmit`, raw EXIT lines. Do NOT run the full suite (controller does). Commit `feat(db): neon-serverless driver for real transactions + FOR UPDATE overpay lock (C-8)`.

## Report

Status; resolved ws/@types/ws versions; the Db type arm change + any tsc ripple; how the FOR UPDATE lock landed in recordPayment; raw EXIT lines; commit SHA; surprises (especially any neon-serverless drizzle type mismatch vs neon-http).

---

## Final verification (controller)

Full suite detached (all pglite — proves the local path is intact). `npx tsc --noEmit`. `npx next build` (proves ws + neon-serverless bundle). Write `docs/DEPLOY-NEON.md`: the user-run smoke-test (set DATABASE_URL to a Neon branch, `npm run db:migrate`, deploy, then: record a payment → succeeds (transaction works); attempt an overpay → friendly rejection; a second concurrent record on one invoice → one succeeds/one rejected). Adversarial review: pglite path truly unchanged; the ws ctor guard is correct for Node 20 AND 22+; the Db union change didn't weaken any consumer's types; FOR UPDATE placement is inside the tx and org-scoped; no secret/URL logged. Merge --no-ff → ROADMAP C-8 shipped (with a "Neon path verified on deploy: PENDING USER" note) + HANDOFF → clean up `.worktrees/slice-c7-hardening` + branch.

## Done condition

- 1 impl commit + `docs/DEPLOY-NEON.md` + docs; ONE new dep (`ws`, approved — required by neon-serverless on Node < 22)
- Full suite green (pglite path intact); tsc clean; next build clean
- ROADMAP C-8 shipped with the explicit "real-Neon smoke-test pending the user's deploy" caveat
