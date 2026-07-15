# Slice 38 — Anomaly Sentinel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Snapshot memory + band-drop detection composing the 24/25/36 stack. An anomaly is an activity event — feeds + watcher emails come free.

**Spec (authoritative):** `docs/superpowers/specs/2026-07-03-anomaly-sentinel-slice-38-design.md`

**Working directory:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-38-sentinel`

**House rules:** exit-code capture via log-file + `echo "EXIT=$?"`; node_modules installed; TDD; NO detached full-suite runs (controller owns it); shared-db harness for DB tests; demo RSC harness from `test/app/customer-edit-activity.test.tsx`.

**Reference files:** `src/db/schema.ts` (watchlists = newest table conventions), `src/lib/watchlists/notify.ts` (Safely-wrapper style), `src/lib/customers/healthScore.ts` (HealthBand, bandRank source of truth is HERE — reuse, don't redefine), `src/app/(admin)/customers/page.tsx` (the score map to feed capture), `src/lib/sentinel/` is NEW.

---

## Task 38-1 — Schema + migration 0019 + whitelist + demo seed

**Files:** `src/db/schema.ts` (+`customerHealthSnapshots` per spec §3), `src/lib/activity/types.ts` (+`"health_dropped"` verb in a new `// sentinel` group), `src/components/activity/ActivityList.tsx` (dot map + rose), `src/lib/demo/seed.ts` (+`DEMO_HEALTH_SNAPSHOTS`: customers 2201/2204, 3 days each ending today-ish via the file's relative helpers, 2204's sequence embedding a healthy→watch drop), generate `drizzle/0019_*.sql`, `test/db/health-snapshots-migration-smoke.test.ts`, extend `test/lib/demo/seed.test.ts` (integrity describe).

Steps: schema append (mirror `watchlists` conventions incl. the `mode:"date"` comment on captured_at; `captured_on` is `text`) → `npx drizzle-kit generate` → verify DDL (table, FK cascade on org only, NO customer FK, unique + index names per spec) → smoke test (mirror watchlists smoke: columns, FK, unique dup rejection, index names, jsonb round-trip) → whitelist + dot map (one-line each; verify ActivityList test still passes, add a `health_dropped`→rose case to its dot-map test) → seed + integrity tests → scoped runs + tsc → commit `feat(db): customer_health_snapshots + sentinel verb (slice 38-1)`.

## Task 38-2 — Capture + detection

**Files:** `src/lib/sentinel/capture.ts` (+ small `toUtcDay`/`bandRank` helpers — bandRank derives from the `HealthBand` union; export both for trend + tests), `test/lib/sentinel/capture.test.ts`.

Semantics: spec §4 EXACTLY. `recordActivitySafely` is called with `actor: null`, `entityType: "customer"`, `verb: "health_dropped"`. Mock nothing in the happy-path DB tests except demo-mode env; for the event-emission assertions read `activity_events` rows directly (the real chokepoint runs — sendEmail is simulated in tests since no RESEND key, so no fetch fires; cooldown updates don't happen for simulated sends — irrelevant here).

Tests (shared-db): first-of-day insert; same-day second call updates score, adds NO second snapshot row and NO event; healthy→watch drop emits exactly one event (payload prevBand/band/prevScore/score, actor null); watch→healthy improvement emits nothing; steady emits nothing; first-ever snapshot emits nothing; demo skip (stubEnv → zero rows written); build-phase skip; error swallow (pass a broken db double for the SELECT → resolves void; or vi.mock recordActivitySafely to throw → capture still resolves).

**Composition test (required):** insert a watchlist row (via direct db insert) watching customer X with a stale last_notified_at; vi.mock `@/lib/email/sendEmail` to capture calls; stub RESEND-less env is fine because the MOCK intercepts before the env check — assert the drop path called sendEmail once with feature "watchlist-alert" and subject containing "Health dropped". (This exercises capture → recordActivitySafely → notifyWatchersSafely → sendEmail end-to-end.)

Commit `feat(sentinel): captureHealthSnapshots + band-drop detection (slice 38-2)`.

## Task 38-3 — Trend reader + surfaces

**Files:** `src/lib/sentinel/trend.ts`, `test/lib/sentinel/trend.test.ts`, `src/app/(admin)/customers/page.tsx` (call `captureHealthSnapshots` after the score map — await, it self-guards), `src/app/(admin)/customers/[id]/edit/page.tsx` (trend line under the badge row per spec §5/§6), extend `test/app/customer-edit-activity.test.tsx` (demo: trend text renders for 2201 — compute expected direction from the seed you wrote in 38-1).

Trend tests (shared-db + demo branch): 7-day pick among multiple candidates (closest ≤ boundary); young-history fallback (oldest when ≥2 rows, all <7d); single row → null; empty → null; demo branch returns seed-derived shape.

Page-wiring test: extend `test/app/` customers-list coverage if a list page test exists (check `ls test/app/`); if none exists, add `test/app/customers-page-capture.test.tsx` asserting the page renders in demo AND (demo-mode) capture writes nothing — the demo skip keeps the RSC harness DB-free, same as every other page test.

Commit `feat(sentinel): snapshot trend on health card + capture wiring (slice 38-3)`.

---

## Final verification (controller)

Full suite detached → expect ~1269 baseline + ~30 ≈ 1300, VITEST_EXIT=0. tsc → 0. Final review → merge → ROADMAP `shipped:` + HANDOFF.

## Done condition

3 commits + docs; migration 0019; zero new deps; demo shows the trend line; a real band drop emails watchers (proven by the composition test); ROADMAP row 38 shipped.
