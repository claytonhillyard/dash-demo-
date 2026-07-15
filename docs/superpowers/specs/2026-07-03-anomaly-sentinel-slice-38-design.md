# iDesign Command Center — Slice 38: Anomaly Sentinel — Design

**Date:** 2026-07-03
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 36 (`computeHealthScore` + the customers-page score computation), slice 24/24b/24c (activity events + feeds), slice 25 (`recordActivitySafely → notifyWatchersSafely` — the alert channel).

**Core composition:** an anomaly IS an activity event. Emitting it via `recordActivitySafely` gives feed rendering (24c) and watcher emails (25) for free. This slice adds detection + memory only.

## 1. Goals

- `customer_health_snapshots` table (migration `0019`) — one row per customer per UTC day.
- `captureHealthSnapshots(db, orgId, scored, now)` — piggybacks on the customers-list render (scores already computed there by slice 36); first-capture-of-day inserts + runs the anomaly check; same-day re-renders update the score silently; demo/build skipped; best-effort (page render can never fail on Sentinel writes).
- Band-drop detection: today's band worse than the prior snapshot's → emit activity event `verb: "health_dropped"`, `actor: null` (first system events in the log), summary `` `Health dropped: ${name} ${prevBand} → ${band}` ``, payload `{ prevBand, band, prevScore, score }`. Watchers of that customer are emailed automatically via the 25 chokepoint.
- `getSnapshotTrend(db, orgId, customerId, now)` — latest snapshot + the one closest to 7 days back; edit-page Health card renders `▲ +12 vs last week` / `▼ -9` / `— no history yet`.
- `ActivityList` verb-dot map: `health_dropped` → rose.
- Demo mode: `DEMO_HEALTH_SNAPSHOTS` seed (2 customers × a few days, one embedded drop) so the trend line renders in demo; capture + detection never run in demo.

## 2. Non-goals (named homes)

- **Cron/scheduled capture** — post-credits infra slice; capture-on-read is the v1 trigger, `captureHealthSnapshots` is trigger-agnostic by design.
- **Retention/pruning** — one row/customer/day = ~36.5k rows/yr at 100 customers; revisit at real volume.
- **Anomaly rules beyond band drops** (velocity spikes, dormancy streaks, deal-level anomalies) — 38b, on this snapshot substrate.
- **Digest/batching, improvement celebrations, Sentinel dashboard panel** — cooldown bounds v1 volume; ActivityPanel already surfaces the events.

## 3. Schema (migration `0019`)

```
customer_health_snapshots
  id            serial PK
  org_id        int  NOT NULL FK → orgs(id) ON DELETE CASCADE
  customer_id   int  NOT NULL           -- no FK: snapshots survive customer deletion (audit-adjacent, mirrors activity_events.entity_id)
  score         int  NOT NULL
  band          text NOT NULL
  components    jsonb NOT NULL          -- { recency, frequency, breadth }
  captured_on   text NOT NULL           -- UTC "YYYY-MM-DD" (derived from injected now)
  captured_at   timestamptz DEFAULT now() NOT NULL
UNIQUE (org_id, customer_id, captured_on)  → customer_health_snapshots_org_customer_day_unique
INDEX  (org_id, customer_id, captured_on DESC) → customer_health_snapshots_org_customer_idx
```

## 4. Capture semantics — `src/lib/sentinel/capture.ts`

`captureHealthSnapshots(db, orgId, scored: Array<{ customerId, name, score, band, components }>, now = new Date())`:

1. Return immediately if `isDemoMode() || isBuildPhase()` or `scored` empty.
2. One SELECT: each listed customer's latest snapshot (`DISTINCT ON (customer_id) … ORDER BY customer_id, captured_on DESC` — standard PG, pglite-supported; scope `org_id` + `customer_id IN (...)`).
3. Per customer: `today = toUtcDay(now)`.
   - Latest snapshot is for `today` → UPDATE score/band/components (silent — no re-check; deterministic, no duplicate alerts within a day).
   - Otherwise → INSERT today's row; if a prior snapshot exists AND `bandRank(today) < bandRank(prior)` → emit the `health_dropped` event via `recordActivitySafely` (which chains watcher notification automatically).
4. Whole body try/catch → Sentry tags `{ feature: "sentinel", subStep: "capture" }`, swallow. Never throws.

`bandRank`: at_risk 0 < watch 1 < healthy 2. Drop = strictly lower rank. First-ever snapshot never alerts.

Call site: `src/app/(admin)/customers/page.tsx`, immediately after the slice-36 score map — `await captureHealthSnapshots(db, orgId, scoredRows, now)`.

## 5. Trend — `src/lib/sentinel/trend.ts`

`getSnapshotTrend(db, orgId, customerId, now)` → `{ current: { score, band, capturedOn }, prior: { score, capturedOn } | null } | null`. `prior` = snapshot with `captured_on <= today - 7d` closest to that boundary; fallback: the OLDEST snapshot if history is younger than 7 days but ≥ 2 rows exist; null when < 2 rows. Demo branch reads `DEMO_HEALTH_SNAPSHOTS`. Edit page renders delta text with band-colored arrow (`text-emerald-400` up / `text-rose-400` down / zinc for flat or no history).

## 6. Whitelist + UI touches

- `ACTIVITY_VERBS` += `"health_dropped"` (append in a new `// sentinel` group).
- `ActivityList.verbDotClass`: `health_dropped` → `bg-rose-400`.
- Health card (edit page): trend line under the badge row.

## 7. Test plan

- Migration smoke (0019: columns, FK cascade, unique, index, no customer FK).
- Capture: first-of-day inserts; same-day updates silently (no second event); drop emits event with `actor: null` + correct payload; improvement/steady emit nothing; first-ever snapshot emits nothing; demo/build skip (no writes); best-effort (activity mock throwing doesn't propagate).
- **Composition test:** watcher on customer + band drop → `sendEmail` mock receives the alert (24+25+38 end-to-end through the real chokepoint).
- Trend: 7-day pick, young-history fallback, <2 rows → null, demo branch.
- Health-card trend render (demo harness: up-arrow case from seed).
- Whitelist/dot-map safety (existing seed integrity tests unaffected).

## 8. Decisions

- `customer_id` deliberately has **no FK** — snapshots are audit-adjacent history and must survive customer deletion (same rationale as `activity_events.entity_id`).
- Same-day silence over intra-day re-checks — deterministic, duplicate-free; intra-day velocity rules are 38b.
- UTC day boundary — single-user reality; per-tenant timezones are a settings-slice concern.
- Capture takes the ALREADY-COMPUTED scores — never recomputes; the customers page is the single scoring site.
