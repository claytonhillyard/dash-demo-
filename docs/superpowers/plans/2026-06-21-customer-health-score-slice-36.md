# Slice 36 — Customer Health Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deterministic 0–100 health score per customer (math scores, AI explains) — list badge + detail card + AI insight, zero migrations, zero new deps.

**Architecture:** Pure scoring fn ← one GROUP BY aggregate reader ← two RSC surfaces. AI insight via slice-32 `generateAiText` (feature `"health-score"`), garnish-only (failure renders nothing).

**Spec (authoritative — read §3–§5 before coding):** `docs/superpowers/specs/2026-06-21-customer-health-score-slice-36-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-36-health-score`

**Reference patterns:**
- `src/lib/ai/generateAiText.ts` + `src/lib/ai/types.ts` — the AI seam (feature `"health-score"` already whitelisted)
- `src/db/activityEvents.ts` — reader conventions + demo branches + `toActivityEvent`
- `src/components/activity/ActivityList.tsx` — local color-map convention (`verbDotClass`)
- `test/app/customer-edit-activity.test.tsx` — demo-mode RSC harness (stubEnv + mocked ensureDbReady/getCurrentOrgId + renderToString + next/navigation mock)
- `test/lib/ai/generateAiText.test.ts` — how to mock the `ai` package if needed (page test should mock `@/lib/ai/generateAiText` instead — simpler)

**House rules:** EXIT-code capture on every tsc/vitest (`; echo "EXIT=$?"`, paste raw output). node_modules is installed — do NOT reinstall. TDD: failing test first per task.

---

## Task 36-1 — Pure scoring function

**Files:** Create `src/lib/customers/healthScore.ts`, `test/lib/customers/healthScore.test.ts`

- [ ] **Step 1: Failing tests.** Truth table per spec §6 — key cases (write ~12 tests):

```ts
import { describe, it, expect } from "vitest";
import { computeHealthScore, HEALTH_WEIGHTS } from "@/lib/customers/healthScore";

const NOW = new Date("2026-06-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("computeHealthScore", () => {
  it("fresh customer, no events: recency from createdAt → healthy", () => {
    const r = computeHealthScore(
      { lastActivityAt: null, eventsLast30d: 0, distinctVerbs30d: 0, customerCreatedAt: daysAgo(1) },
      NOW,
    );
    expect(r.band).toBe("healthy");           // 40 recency alone isn't ≥70… see note below
  });
  // ... etc
});
```

**IMPORTANT scoring note for the implementer:** recency alone maxes at 40, which lands in "watch" (40–69), NOT "healthy". A brand-new customer with zero events therefore bands as **watch**, not healthy. The spec's §3 formulas are authoritative — derive the truth-table expectations FROM THE FORMULAS, not from the narrative. Recompute each expected value by hand in a comment next to the assertion, e.g.:

```ts
it("fresh customer created 1 day ago, no events → 40 recency + 0 + 0 = 40 → watch", () => { ... });
it("customer with recent + frequent + broad activity → healthy", () => {
  // recency ≤2d = 40; 8 events = 35; 4 verbs = 25 → 100 → healthy
  const r = computeHealthScore(
    { lastActivityAt: daysAgo(1), eventsLast30d: 8, distinctVerbs30d: 4, customerCreatedAt: daysAgo(90) },
    NOW,
  );
  expect(r.score).toBe(100);
  expect(r.band).toBe("healthy");
});
it("30+ days silent, no recent events → 0 + 0 + 0 = 0 → at_risk", () => { ... });
```

Cover: 2d boundary (full recency), 30d boundary (zero recency), mid-decay value (e.g. 16 days → 40 * (30-16)/28 = 20), frequency saturation (9 events = 35, 4 events = 17.5), breadth saturation (5 verbs = 25, 2 verbs = 12.5), band boundaries (construct inputs yielding exactly 39/40/69/70 — e.g. via mid-decay recency + partial frequency; compute by hand), components sum ≈ score (± rounding), determinism (same inputs+now twice → identical result), `lastActivityAt` preferred over `customerCreatedAt` when both present.

- [ ] **Step 2:** Run → fails (module missing).
- [ ] **Step 3: Implement** per spec §3:

```ts
export const HEALTH_WEIGHTS = {
  recencyMax: 40,
  recencyFullDays: 2,
  recencyZeroDays: 30,
  frequencyMax: 35,
  frequencySaturation: 8,
  breadthMax: 25,
  breadthSaturation: 4,
  healthyMin: 70,
  watchMin: 40,
} as const;

export type HealthBand = "healthy" | "watch" | "at_risk";
export type HealthInputs = { lastActivityAt: Date | null; eventsLast30d: number; distinctVerbs30d: number; customerCreatedAt: Date };
export type HealthScore = { score: number; band: HealthBand; components: { recency: number; frequency: number; breadth: number } };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Deterministic, explainable health heuristic. The math scores; the AI
 *  (healthInsight.ts) only explains. `now` injected — no Date.now() here. */
export function computeHealthScore(inputs: HealthInputs, now: Date): HealthScore {
  const anchor = inputs.lastActivityAt ?? inputs.customerCreatedAt;
  const daysSince = (now.getTime() - anchor.getTime()) / 86_400_000;
  const { recencyMax, recencyFullDays, recencyZeroDays, frequencyMax, frequencySaturation, breadthMax, breadthSaturation, healthyMin, watchMin } = HEALTH_WEIGHTS;

  const recency =
    daysSince <= recencyFullDays
      ? recencyMax
      : recencyMax * clamp01((recencyZeroDays - daysSince) / (recencyZeroDays - recencyFullDays));
  const frequency = frequencyMax * clamp01(inputs.eventsLast30d / frequencySaturation);
  const breadth = breadthMax * clamp01(inputs.distinctVerbs30d / breadthSaturation);

  const score = Math.min(100, Math.max(0, Math.round(recency + frequency + breadth)));
  const band: HealthBand = score >= healthyMin ? "healthy" : score >= watchMin ? "watch" : "at_risk";
  return { score, band, components: { recency, frequency, breadth } };
}
```

- [ ] **Step 4:** Tests pass; `npx tsc --noEmit` → 0.
- [ ] **Step 5:** Commit `feat(customers): computeHealthScore pure heuristic (slice 36-1)`

---

## Task 36-2 — Aggregate reader + demo branch

**Files:** Modify `src/db/activityEvents.ts`; extend `test/db/activityEvents.test.ts`

- [ ] **Step 1: Failing tests** — append a `describe("getCustomerActivityStats", ...)` to the existing test file (reuse its shared-db scaffolding + `insertEvents` helper; org 2 insert is already in beforeEach):

Cover: (1) groups per customer id with correct `eventsLast30d` counts; (2) `lastActivityAt` reflects an OLD event (insert one event, then use raw SQL `UPDATE activity_events SET created_at = now() - interval '45 days'` to age it; assert it's excluded from `eventsLast30d` but still sets `lastActivityAt`); (3) distinct-verb counting (3 events, 2 verbs → 2); (4) cross-org isolation (org 2 events invisible); (5) empty Map when no customer events; (6) non-customer entity_types excluded; (7) demo mode: `vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true")` + dynamic import (pattern already in this file's demo describe) → customer 2201 has `eventsLast30d: 2, distinctVerbs30d: 2` (created 9001 + updated 9005, both within 24h of the seed's relative NOW).

- [ ] **Step 2:** Run → fails (export missing).
- [ ] **Step 3: Implement** per spec §4. Drizzle notes: use raw `sql` fragments for the FILTER aggregates:

```ts
export async function getCustomerActivityStats(
  db: Db,
  viewerOrgId: number,
  now: Date = new Date(),
): Promise<Map<number, CustomerActivityStats>> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);

  if (isDemoMode()) {
    const out = new Map<number, CustomerActivityStats>();
    for (const e of DEMO_ACTIVITY) {
      if (e.orgId !== viewerOrgId || e.entityType !== "customer" || e.entityId === null) continue;
      const cur = out.get(e.entityId) ?? {
        entityId: e.entityId,
        lastActivityAt: e.createdAt,
        eventsLast30d: 0,
        distinctVerbs: new Set<string>(),
      } as CustomerActivityStats & { distinctVerbs: Set<string> };
      // ... accumulate max date + windowed counts + verb set, then map Set → size
    }
    // return the finalized Map (convert the accumulator shape → CustomerActivityStats)
  }

  const rows = await db.execute(sql`
    SELECT entity_id,
           max(created_at) AS last_activity_at,
           count(*) FILTER (WHERE created_at > ${cutoff}) AS events_last_30d,
           count(DISTINCT verb) FILTER (WHERE created_at > ${cutoff}) AS distinct_verbs_30d
      FROM activity_events
     WHERE org_id = ${viewerOrgId} AND entity_type = 'customer' AND entity_id IS NOT NULL
     GROUP BY entity_id
  `);
  // map rows → Map<number, CustomerActivityStats>; coerce last_activity_at via
  // instanceof Date ? : new Date(...) (house convention, slice 24c review) and
  // Number(...) the counts — raw execute returns strings for bigint counts.
}
```

Implementer notes: define `CustomerActivityStats` in `src/db/activityEvents.ts` and export; the demo accumulator can use a local intermediate type — keep the exported shape clean. Verify pglite accepts `FILTER` (it's standard PG; the smoke test will tell you immediately).

- [ ] **Step 4:** Tests pass; tsc → 0.
- [ ] **Step 5:** Commit `feat(activity): getCustomerActivityStats aggregate reader (slice 36-2)`

---

## Task 36-3 — HealthBadge + customers list column

**Files:** Create `src/components/customers/HealthBadge.tsx`, `test/components/customers/HealthBadge.test.tsx`; modify `src/components/customers/CustomersTable.tsx`, `src/app/(admin)/customers/page.tsx`; extend `test/components/customers/CustomersTable.test.tsx`

- [ ] **Step 1: HealthBadge (test first, then component):**

```tsx
import type { HealthBand } from "@/lib/customers/healthScore";

const BAND_DOT: Record<HealthBand, string> = {
  healthy: "bg-emerald-400",
  watch: "bg-amber-300",
  at_risk: "bg-rose-400",
};
const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
};

export function HealthBadge({ score, band }: { score: number; band: HealthBand }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={BAND_LABEL[band]} data-health-band={band}>
      <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT[band]}`} />
      <span className="text-sm text-zinc-200">{score}</span>
    </span>
  );
}
```

Tests: three bands → correct dot class (query `[data-health-band]` container, check inner span className), score text, title attr.

- [ ] **Step 2: Table column.** Read `CustomersTable.tsx` first. Extend `CustomerView` with `health: { score: number; band: HealthBand }`. Add `<th role="columnheader">Health</th>` between Phone and the right-aligned actions header; matching `<td>` renders `<HealthBadge {...c.health} />`. Update the existing table tests' fixture rows to include `health` (they'll fail to compile otherwise — that IS the failing-test step) + add one assertion that a badge renders per row.

- [ ] **Step 3: Page wiring.** In `customers/page.tsx`: fetch stats + compute alongside the existing customer fetch:

```ts
const now = new Date();
const [customers, stats] = await Promise.all([
  getCustomers(db, orgId, { search: q }),
  getCustomerActivityStats(db, orgId, now),
]);
const rows = customers.map((c) => {
  const s = stats.get(c.id);
  const health = computeHealthScore(
    {
      lastActivityAt: s?.lastActivityAt ?? null,
      eventsLast30d: s?.eventsLast30d ?? 0,
      distinctVerbs30d: s?.distinctVerbs30d ?? 0,
      customerCreatedAt: c.createdAt,
    },
    now,
  );
  return { ...c, health: { score: health.score, band: health.band } };
});
```

Pass `rows` to the table. Check what shape `CustomersTable` currently receives (`CustomerView[]`) and thread `health` through cleanly.

- [ ] **Step 4:** Run `npx vitest run test/components/customers/; echo "EXIT=$?"` → all pass. tsc → 0.
- [ ] **Step 5:** Commit `feat(customers): health score column on customers list (slice 36-3)`

---

## Task 36-4 — Insight prompt builder + edit-page Health card

**Files:** Create `src/lib/customers/healthInsight.ts`, `test/lib/customers/healthInsight.test.ts`; modify `src/app/(admin)/customers/[id]/edit/page.tsx`; extend `test/app/customer-edit-activity.test.tsx`

- [ ] **Step 1: Prompt builder (test first).** Type-level PII exclusion — the input type has NO email/phone/address/notes fields:

```ts
export type HealthInsightInput = {
  name: string;
  score: number;
  band: HealthBand;
  components: { recency: number; frequency: number; breadth: number };
  eventsLast30d: number;
  lastActivityAt: Date | null;
};

export function buildHealthInsightPrompt(input: HealthInsightInput, now: Date): string;
```

Prompt shape (short, structured): system-style instruction to write 2–3 sentences for a business owner about this customer relationship's health, given: name, score/band, days since last touch, events in 30d, weakest component. Tests: contains name + score + band words; contains days-since figure; deterministic for fixed now; **PII guard:** construct the full input from a customer object spread — TS must reject `buildHealthInsightPrompt({ ...customerWithEmail })` shape excess at compile time (write the test as a type-level `@ts-expect-error` line) AND assert the output string never contains an `@` character when name has none.

- [ ] **Step 2: Edit-page card.** In the edit page, ABOVE the slice-24c Activity section:

```tsx
<section className="mt-8">
  <h2 className="mb-2 text-sm font-semibold text-zinc-200">Health</h2>
  <div className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
    <div className="mb-2 flex items-center gap-3">
      <HealthBadge score={health.score} band={health.band} />
      <span className="text-xs uppercase tracking-wider text-zinc-400">{/* band label */}</span>
    </div>
    {/* three component bars: label + a bg-zinc-800 track with an inner div
        style={{ width: `${(value / max) * 100}%` }} using the band color */}
    {insightText ? <p className="mt-3 text-sm text-zinc-300">{insightText}</p> : null}
  </div>
</section>
```

Data flow in the page: reuse `getEntityActivity`? NO — the card needs aggregates; call `getCustomerActivityStats(db, orgId, now)` and pick `stats.get(id)` (acceptable: one org-wide grouped query; a per-id variant is premature). Compute `health`, build prompt, `const insight = await generateAiText({ feature: "health-score", tier: "fast", user: `org:${orgId}`, prompt, maxOutputTokens: 160 });` and `const insightText = insight.ok ? insight.text : null;`.

- [ ] **Step 3: Page test.** Extend the demo-harness test file: demo mode → the Health section heading renders; a numeric score renders; the insight paragraph contains `[simulated]` (demo mode short-circuits generateAiText to simulated — no mock of the AI module needed; verify that's true by reading generateAiText's demo branch — it is: isDemoMode() is checked first).
- [ ] **Step 4:** Run the two test files + tsc → all green.
- [ ] **Step 5:** Commit `feat(customers): health card + AI insight on edit page (slice 36-4)`

---

## Final verification (controller)

Full suite detached (`/tmp/slice36-final.*`) → expect ~1136 baseline + ~25 new ≈ 1161, VITEST_EXIT=0. tsc → 0. Final review → merge `--no-ff` → push → ROADMAP `shipped:` + HANDOFF.

## Done condition

- 4 commits; no migration; no new deps
- List shows Health column; edit page shows Health card with simulated insight in demo
- Full suite green; tsc clean; ROADMAP row 36 `shipped: <sha>`
