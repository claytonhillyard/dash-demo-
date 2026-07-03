# iDesign Command Center — Slice 36: Customer Health Score — Design

**Date:** 2026-06-21
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 22 (customers), slice 24/24b (activity_events — the signal source), slice 24c (edit-page Activity section + demo RSC test harness), slice 32 (`generateAiText`, feature tag `"health-score"` pre-whitelisted).

**Unlocks:** slice 38 (Anomaly Sentinel — adds score snapshots/trends + alerting on band drops).

---

## 1. Overview & Goals

Every customer row gets a 0–100 health score with a colored band. **The math scores; the AI explains.** The score is a deterministic, explainable heuristic over audit-log aggregates — unit-testable, free, fully demo-capable. The AI layer only renders a natural-language insight paragraph on the detail page via `generateAiText` (simulated when keyless, by design).

**Goals:**
- Pure scoring function `computeHealthScore` — no I/O, `now` injected for determinism.
- One aggregate reader `getCustomerActivityStats` — a single GROUP BY query for the whole org (no N+1), demo branch included.
- Customers list gains a "Health" column (dot + score).
- Customer edit page gains a "Health" card (score, band, component breakdown, AI insight paragraph).
- PII discipline: the AI prompt contains counts, dates, band, and the customer's display name only — never email/phone/address/notes.

## 2. Non-goals (named homes)

- **Score persistence / history / trends** — slice 38 adds the snapshot table (Sentinel needs time-series anyway).
- **Per-tenant configurable weights** — future settings slice; constants are exported for 38 to reuse.
- **Deal/org-level health** — slice 38.
- **Alerts on band drop** — slices 25 (Resend infra) + 38.
- **Dashboard-panel surfacing** — later polish; the list badge is the visibility win this slice.
- **Backfill/import interaction** — scores read live aggregates; no stored state to backfill.

## 3. Scoring model — `src/lib/customers/healthScore.ts` (pure)

```ts
export type HealthBand = "healthy" | "watch" | "at_risk";

export type HealthInputs = {
  lastActivityAt: Date | null;   // max(created_at) over ALL events for this customer
  eventsLast30d: number;         // count of events in the trailing 30 days
  distinctVerbs30d: number;      // distinct verbs in the trailing 30 days
  customerCreatedAt: Date;       // fallback recency anchor when no events exist
};

export type HealthScore = {
  score: number;                 // 0–100 integer
  band: HealthBand;
  components: { recency: number; frequency: number; breadth: number }; // pre-round contributions
};

export function computeHealthScore(inputs: HealthInputs, now: Date): HealthScore;
```

**Components:**
- **Recency (0–40):** `daysSince = (now - (lastActivityAt ?? customerCreatedAt)) / 86_400_000`. Full 40 points at ≤2 days; linear decay to 0 at ≥30 days: `40 * clamp((30 - daysSince) / 28, 0, 1)`.
- **Frequency (0–35):** `35 * clamp(eventsLast30d / 8, 0, 1)` — saturates at 8 events/30d.
- **Breadth (0–25):** `25 * clamp(distinctVerbs30d / 4, 0, 1)` — saturates at 4 distinct verbs. Transacting (bids, comments) beats mere record edits.
- `score = round(recency + frequency + breadth)`, clamped 0–100.

**Bands:** `score >= 70 → "healthy"`, `40–69 → "watch"`, `< 40 → "at_risk"`. Colors: emerald / amber / rose (matches ActivityList verb-dot palette).

**Determinism:** `now` is a required parameter — no `Date.now()` inside the function. Weights exported as `HEALTH_WEIGHTS` const for slice 38 reuse.

## 4. Aggregate reader — extend `src/db/activityEvents.ts`

```ts
export type CustomerActivityStats = {
  entityId: number;
  lastActivityAt: Date;        // max(created_at) over ALL time
  eventsLast30d: number;
  distinctVerbs30d: number;
};

export async function getCustomerActivityStats(
  db: Db,
  viewerOrgId: number,
  now?: Date,                  // injected for tests; defaults to new Date()
): Promise<Map<number, CustomerActivityStats>>;
```

One query:

```sql
SELECT entity_id,
       max(created_at)                                            AS last_activity_at,
       count(*)      FILTER (WHERE created_at > $cutoff30d)       AS events_last_30d,
       count(DISTINCT verb) FILTER (WHERE created_at > $cutoff30d) AS distinct_verbs_30d
  FROM activity_events
 WHERE org_id = $viewerOrgId AND entity_type = 'customer' AND entity_id IS NOT NULL
 GROUP BY entity_id
```

- **`max(created_at)` is unwindowed** — recency must see a 45-day-old last touch (the decay math handles staleness; NULLing it out would punish long-standing customers twice).
- The 30-day window applies to frequency + breadth only (Postgres `FILTER` clause; supported by pglite).
- Rides `activity_events_org_entity_idx`. Drizzle: raw `sql` fragments for the filtered aggregates are acceptable.
- **Demo branch:** compute identical aggregates from `DEMO_ACTIVITY` in memory (org filter, entity_type "customer", same windowing off the injected `now`).
- Returned as a `Map` keyed by customer id — the list page zips it against `getCustomers` rows; missing key = zero events (score falls back to `customerCreatedAt` recency).

## 5. Surfaces

### 5.1 `<HealthBadge>` — `src/components/customers/HealthBadge.tsx`

Presentational: colored dot + numeric score, `title` attr = band label. Band→color map local to the component (mirrors ActivityList's `verbDotClass` approach). Used by both table and card.

### 5.2 Customers list — modify `CustomersTable.tsx` + `customers/page.tsx`

- Page: fetch `getCustomerActivityStats(db, orgId)` alongside `getCustomers`, compute `computeHealthScore` per row server-side (one `now = new Date()` for the whole render), pass `health` (score+band) into each row view.
- Table: new "Health" `<th>` between Phone and the right-aligned column; cell renders `<HealthBadge>`.
- `CustomerView` prop type extends with `health: { score: number; band: HealthBand }`.

### 5.3 Customer edit page — modify `customers/[id]/edit/page.tsx`

"Health" card ABOVE the Activity section (slice 24c): score + band chip, three component bars (simple width-% divs, no chart lib), and the AI insight paragraph:

```ts
const insight = await generateAiText({
  feature: "health-score",
  tier: "fast",
  user: `org:${orgId}`,
  prompt: buildHealthInsightPrompt({ name: customer.name, score, band, components, eventsLast30d, lastActivityAt }, now),
  maxOutputTokens: 160,
});
```

- Render `insight.ok ? insight.text : null` (a failed AI call renders no paragraph — the card's numbers stand alone; never an error state for a garnish).
- In demo/keyless mode the `[simulated]` text renders — visibly a placeholder, correct pre-key posture.

### 5.4 Prompt builder — `src/lib/customers/healthInsight.ts` (pure)

`buildHealthInsightPrompt(input, now): string` — includes customer display name, score, band, per-component points, event count, days-since-last-activity. **MUST NOT accept or embed email, phone, address, or notes** — enforced by the input type (those fields simply aren't parameters) and asserted by a unit test.

## 6. Test plan

- `test/lib/customers/healthScore.test.ts` — truth table: fresh customer (created today, no events) → healthy; 30+ days stale + no events → at_risk; recency decay boundaries (2d full, 30d zero); frequency/breadth saturation; band boundaries at exactly 39/40/69/70; components sum ≈ score; determinism (fixed `now`).
- `test/db/activityEvents.test.ts` (extend) — stats: cross-org isolation; grouping across multiple customers; 30d window excludes old events from counts but NOT from `lastActivityAt`; distinct-verb counting; empty map when no events; demo branch returns aggregates consistent with `DEMO_ACTIVITY` (customer 2201 → 2 events, 2 distinct verbs).
- `test/lib/customers/healthInsight.test.ts` — prompt contains name/score/band/counts; type-level PII exclusion + runtime assertion that a crafted input cannot leak an email-shaped string (no email param exists).
- `test/components/customers/HealthBadge.test.tsx` — three bands render correct color class + score + title.
- `test/components/customers/CustomersTable.test.tsx` (extend) — Health column header + badge per row.
- `test/app/customer-edit-activity.test.tsx` (extend or sibling file) — demo-mode edit page renders the Health card with a numeric score and the `[simulated]` insight text.

## 7. Decisions

- Recency anchored to unwindowed `lastActivityAt` with `customerCreatedAt` fallback — never NULL-punished.
- `now` injected end-to-end (pure fn + reader param) — deterministic tests, single consistent render timestamp.
- AI insight is a garnish: failure renders nothing, never an error UI.
- Weights/saturation constants exported (`HEALTH_WEIGHTS`) for slice 38, not configurable per tenant yet.
- Component bars are plain divs — no chart dependency for three numbers.
