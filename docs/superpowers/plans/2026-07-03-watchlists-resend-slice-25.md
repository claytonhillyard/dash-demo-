# Slice 25 — Watchlists + Email Alerts (Resend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the Resend email seam + watchlists (watch an entity, get emailed on activity) riding the `recordActivitySafely` chokepoint.

**Spec (authoritative — the type contracts, schema, and semantics live there; read the cited §§ before coding):** `docs/superpowers/specs/2026-07-03-watchlists-resend-slice-25-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-25-watchlists`

**House rules:** EXIT-code capture on every tsc/vitest (`; echo "EXIT=$?"`, paste raw). node_modules installed — no reinstalls. TDD per task. NO detached full-suite runs from subagents — controller owns the final suite. Shared-db tests use `test/helpers/shared-db.ts`; demo-mode RSC tests copy the `test/app/customer-edit-activity.test.tsx` harness.

**Reference patterns:**
- `src/lib/ai/generateAiText.ts` + `test/lib/ai/generateAiText.test.ts` — the seam shape + env truth-table testing (slice 32; sendEmail mirrors it with fetch instead of the SDK)
- `src/lib/market/providers/finnhub.ts` — plain-fetch provider conventions
- `src/lib/customers/actions.ts` — `run()` wrapper to copy for watchlist actions
- `src/lib/activity/recordActivitySafely.ts` — the hook site (25-4)
- `src/db/schema.ts` `activityEvents` + `drizzle/0017_*` — migration conventions (this slice generates `0018`)
- `src/components/customers/CustomerForm.tsx` — client-component action-call conventions for WatchToggle
- `src/app/(admin)/customers/page.tsx` + `Nav.tsx` — page + nav conventions for /watchlists

---

## Task 25-1 — Email seam

**Files:** Create `src/lib/email/types.ts`, `src/lib/email/sendEmail.ts`, `test/lib/email/sendEmail.test.ts`; modify `.env.example` (+`RESEND_API_KEY`, `EMAIL_FROM`).

- [ ] Types verbatim from spec §3.1.
- [ ] Failing tests first — mock `globalThis.fetch` via `vi.stubGlobal("fetch", vi.fn())` and `@sentry/nextjs` via the house mock (copy from `test/lib/ai/generateAiText.test.ts`). Cases (spec §7 bullet 1): no-key → simulated + fetch NOT called; demo (`NEXT_PUBLIC_DEMO_MODE=true`) → simulated; build phase (`NEXT_PHASE=phase-production-build`) → simulated; live 200 → `{ ok: true, simulated: false }` + fetch called once with Bearer header + from/to/subject/text body; 429 → `rate_limited`; 500 → `unavailable`; fetch rejects → `error`; invalid `to` (not an email) → `error` + fetch NOT called; Sentry failure tags contain `feature` + `statusCode` and JSON.stringify(tags) does NOT contain the recipient address; `durationMs >= 0` on all paths; wrap-all assertion that no case throws.
- [ ] Implement per spec §3.2. Decision-order guard identical in shape to `generateAiText` (isDemoMode/isBuildPhase imports from the same modules). Zod schema local to the module (`sendEmailInputSchema`). Response mapping: `res.status === 429 → rate_limited`, `res.status >= 500 → unavailable`, other `!res.ok → error`.
- [ ] `.env.example`: append the two keys with one-line comments (mirror existing entries' style).
- [ ] Run scoped tests + tsc → green. Commit `feat(email): sendEmail Resend seam (slice 25-1)`.

## Task 25-2 — Schema + migration 0018 + whitelist extension

**Files:** Modify `src/db/schema.ts` (append `watchlists` pgTable per spec §4.1), `src/lib/activity/types.ts` (append `"watchlist"` to `ACTIVITY_ENTITY_TYPES`; `"watched"`, `"unwatched"` to `ACTIVITY_VERBS` — keep the group comments); generate `drizzle/0018_*.sql`; create `test/db/watchlists-migration-smoke.test.ts`.

- [ ] pgTable: columns exactly per spec §4.1; unique via `uniqueIndex("watchlists_org_actor_entity_unique")`, index `watchlists_org_entity_idx`; FK `onDelete: "cascade"`; `createdAt` with the same `mode:"date"` + comment convention as `activityEvents` (slice 24 review precedent).
- [ ] `npx drizzle-kit generate` → verify 0018 SQL contains table + FK + unique + index.
- [ ] Smoke test mirrors `test/db/activity-events-migration-smoke.test.ts` (own PGlite instance): columns/nullability; FK rejects unknown org; UNIQUE violation on duplicate (org, actor, entity_type, entity_id); index names present; `ON CONFLICT (id) DO NOTHING` guard on the org insert (migration 0004 seeds org 1).
- [ ] Whitelist extension: verify no existing test asserts exact whitelist lengths (grep `ACTIVITY_VERBS` in test/ — the seed integrity tests iterate, they don't count; adjust if any do).
- [ ] Scoped tests + tsc → green. Commit `feat(db): watchlists table + activity whitelist extension (slice 25-2)`.

## Task 25-3 — Actions + queries + demo seed

**Files:** Create `src/lib/watchlists/actions.ts`, `src/lib/watchlists/queries.ts`, `test/lib/watchlists/actions.test.ts`; modify `src/lib/demo/seed.ts` (`DEMO_WATCHLISTS`, 2 entries on customers 2201/2204, `notify_email: "owner@aiya.demo"`, ids 9101/9102) + extend `test/lib/demo/seed.test.ts` (integrity: 2 entries, org 1, whitelisted entity types, email shape).

- [ ] Copy `src/lib/customers/actions.ts`'s scaffolding: `__setTestDb`, `db()`, `run()` (same demo guard + ForbiddenError + safeErrShape/mapDbConstraintError — import the exported helpers from customers/actions if exported, otherwise copy the small pieces; PREFER importing `safeErrShape` which IS exported).
- [ ] `watchEntity`: Zod per spec §4.2; drizzle `insert(...).values(...).onConflictDoUpdate({ target: [org_id, actor, entity_type, entity_id columns], set: { notifyEmail } })`; audit event AFTER success via `recordActivitySafely` (`entityType: "watchlist"`, `verb: "watched"`, entityId = the watchlist row id, summary per spec — NO email address in summary or payload; payload `{ watchedEntityType, watchedEntityId }`).
- [ ] `unwatchEntity`: DELETE `.returning()`; audit `"unwatched"` only when `returning().length > 0`; ok on no-op.
- [ ] Queries per spec §4.3 with demo branches (import `DEMO_WATCHLISTS`).
- [ ] Truth-table tests per spec §7 bullet 3 (shared-db harness; mock `requireSession` like customers' tests do; assert audit rows via `activityEvents` selects; assert the audit payload JSON does NOT contain "owner@" or "@" from the notify email).
- [ ] Scoped tests + tsc → green. Commit `feat(watchlists): watch/unwatch actions + queries + demo seed (slice 25-3)`.

## Task 25-4 — buildAlertEmail + notifyWatchersSafely + chokepoint hook

**Files:** Create `src/lib/watchlists/buildAlertEmail.ts`, `src/lib/watchlists/notify.ts`, `test/lib/watchlists/buildAlertEmail.test.ts`, `test/lib/watchlists/notify.test.ts`; modify `src/lib/activity/recordActivitySafely.ts` (hook) + extend `test/lib/activity/recordActivitySafely.test.ts`.

- [ ] `buildAlertEmail(event: RecordActivityInput, now: Date): { subject: string; text: string }` — pure. Subject `` `[iDesign] Activity: ${event.summary}` `` (subject capped at 200 — truncate summary with ellipsis if needed). Text: summary line, actor line (`by ${actor ?? "system"}`), entity path line per spec §5 mapping. Tests: shape, path map (customer/deal/other), truncation, determinism.
- [ ] `notify.ts` per spec §5 semantics EXACTLY (skip null-entityId + demo first; indexed SELECT with cooldown predicate + LIMIT `WATCH_NOTIFY_CAP`; sendEmail per watch; `last_notified_at` update ONLY on `ok && !simulated`; total wrap → Sentry tags `{ feature: "watchlist-alert", subStep: "notifyWatchers" }` + swallow). Cooldown predicate in drizzle: `or(isNull(lastNotifiedAt), lt(lastNotifiedAt, cutoff))`.
- [ ] Hook: in `recordActivitySafely`, after `await recordActivity(db, input);` add `await notifyWatchersSafely(db, input);` (inside the existing try). Update the module doc comment to mention dispatch. **Cycle check:** `notify.ts` imports NOTHING from `watchlists/actions.ts` — schema + sendEmail + types only.
- [ ] `notify.test.ts` (mock `@/lib/email/sendEmail` with vi.mock; shared-db for the watchlists table): cases per spec §7 bullet 4 — include the 6-watchers→5-sends cap case and the mock-throws→swallowed case.
- [ ] Extend `recordActivitySafely.test.ts`: mock `@/lib/watchlists/notify` to throw → recordActivitySafely still resolves void (the existing Sentry-mock scaffolding stays intact; add the new vi.mock alongside).
- [ ] Scoped tests + tsc → green. ALSO re-run `test/lib/customers/actions.test.ts` (chokepoint touched — every action test exercises the hook; the notify no-watcher path must not break them). Commit `feat(watchlists): alert dispatch via activity chokepoint (slice 25-4)`.

## Task 25-5 — WatchToggle + customer edit wiring + /watchlists page + nav

**Files:** Create `src/components/watchlists/WatchToggle.tsx`, `test/components/watchlists/WatchToggle.test.tsx`, `src/app/(admin)/watchlists/page.tsx`, `test/app/watchlists-page.test.tsx`; modify `src/app/(admin)/customers/[id]/edit/page.tsx` (toggle above the Activity section, fed by `getWatchForEntity`), `src/components/dashboard/Nav.tsx` (SECTIONS + ROUTES: "Watchlists" → `/watchlists` after "Activity"), extend `test/components/dashboard/Nav.test.tsx` (+1 link assertion) and `test/app/customer-edit-activity.test.tsx` (toggle renders in demo).

- [ ] `WatchToggle` (client): props `{ entityType, entityId, initial: { watching: boolean; notifyEmail: string | null } }` + server actions imported directly (`watchEntity`/`unwatchEntity` — mirror how `CustomerForm` imports + calls its actions with `useTransition`). Unwatched → email input + Watch button; watched → "Watching" label + Unwatch button; inline `role="alert"` error on failure. `router.refresh()` on success (CustomerForm convention).
- [ ] Component tests: unwatched render (input + button), watched render, submit calls action with typed email (mock the actions module), error path renders alert. Copy CustomerForm.test.tsx's next/navigation mock.
- [ ] `/watchlists` page: RSC force-dynamic; `getWatchlistsForActor(db, orgId, actor)` — actor from `requireSession()` in live mode; in demo mode use the demo constant path (`isDemoMode()` → actor is irrelevant, queries' demo branch returns the seed). Table: entity (link per buildAlertEmail's path map), notify email, created, last notified (use `relativeTime`), per-row Unwatch (small client component or reuse WatchToggle in watched state — implementer's choice, keep it simple). Empty state: "No watches yet. Watch a customer from its edit page."
- [ ] Page test (demo harness): 2 seeded rows render with emails; empty-state NOT shown.
- [ ] Nav + tests. Edit-page integration: toggle renders (demo: customer 2201 IS watched per seed → "Watching" state renders).
- [ ] Scoped tests + tsc → green. Commit `feat(watchlists): WatchToggle + /watchlists page + nav (slice 25-5)`.

---

## Final verification (controller)

Full suite detached (`/tmp/slice25-final.*`) → expect ~1175 baseline + ~45 new ≈ 1220, VITEST_EXIT=0. tsc → 0. Grep guards: `RESEND_API_KEY` only under `src/lib/email/`; no email addresses in any Sentry tag path (`grep -rn "notifyEmail\|notify_email" src/lib/activity/ src/lib/email/` → only type-level flows). Final review → merge `--no-ff` → push → ROADMAP `shipped:` + HANDOFF + .env note.

## Done condition

- 5 commits + docs commit; migration 0018; zero new deps
- Demo: /watchlists renders 2 seeds; customer 2201 edit page shows "Watching"; live alerts activate when RESEND_API_KEY + EMAIL_FROM land
- Full suite green; tsc clean; ROADMAP row 25 `shipped: <sha>`
