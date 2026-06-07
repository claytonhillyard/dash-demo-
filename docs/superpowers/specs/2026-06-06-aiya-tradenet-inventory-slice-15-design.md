# AIYA Dashboard — Slice 15: TradeNet Inventory (Cross-Circle Inventory Sharing) — Design

**Date:** 2026-06-06
**Status:** Approved (design); implementation plan companion at `docs/superpowers/plans/2026-06-06-aiya-tradenet-inventory-slice-15.md`
**Builds on:** slices #0/1/1a/1b-1 (inventory ledger + `inventory_items` table + `org_id` tenancy convention), #1b-3 (diamond price lists), #1c (customizable layout), #2 (Deal Room), demo (Netlify simulation mode), #3 (Multi-Tenant Foundation — real `orgs` table, `getCurrentOrgId()` async seam, JWT `{user, orgId}`, cross-org isolation tests), #4 (Circles: `circles` + `circle_members` + `deals.visibility_circle_id` + `getCircleIdsForOrg` + `isOrgMemberOfCircle` + name-leak guard via `formatDealVisibility`), #4c (Circle Onboarding: self-service invitations / accept / decline / leave / remove + `circle_invitations` table + uniform `Forbidden` discipline + `addOrgToCircle` / `removeOrgFromCircle` membership-mutation primitives), #5 (Website Overview), #10 (Deal Reply Threads — denormalized `*_org_label` convention + `canSeeDeal` predicate shape), #11 (Polish + Observability — Sentry tags on action layer), #12 (Web Vitals), #14 (Lighthouse CI), #16 (Bidding — `ForbiddenError` + transaction discipline). Slice 17 (Deal Photos) ships in a parallel session and is intentionally orthogonal — it touches deals, not inventory.

---

## 1. Overview & Goals

Slice 4 widened the **Deal Room** across circles; slice 4c gave orgs the ability to manage those circles themselves. Slice 15 closes the loop on the inventory side of the same architectural template: turn each org's per-org inventory ledger (slice 1b-1) into a **circle-shareable surface**, so AIYA can mark a finished piece or stone parcel as visible to "Trusted Partners" (or any other circle the org belongs to) and the partner orgs see it on a shared **TradeNet Inventory** view.

This is the smallest honest cut of mockup 2's TradeNet Exchange that finally puts inventory on the network. The slice ships **one new column** on `inventory_items` (`visibility_circle_id`), **one new helper** (`getSharedInventoryForOrg`), **one extension** to `updateInventoryItem` (optional `visibilityCircleId` field, validated against the existing slice-4 `isOrgMemberOfCircle` primitive), **two new UI affordances** (per-row share dropdown + "Shared via [Circle]" badge), **one new dashboard panel** (`tradenet-inventory`), and **one new admin route** (`/exchange`). Every existing slice-3 tenancy invariant and every slice-4 widening discipline is preserved verbatim — slice 15 **widens** inventory read visibility along the same strictly-bounded set of circle ids that slice 4 widened deals along; it never replaces a single per-org WHERE clause.

The cut is tight by design: **no bidding on inventory items, no reservations / holds, no per-item per-org pricing, no stock reservations across orgs, no photo gallery per item (slice 17 lays photo groundwork on deals separately), no audit log of cross-circle inventory views, no notifications, no bulk-share UI, no inventory rename / merge / split, no public marketplace visibility**. An owner shares a row by editing it through the existing admin UI; partners see it on the dashboard panel and the new `/exchange` route. Mutating a foreign org's inventory item (qty edits, deletes, status changes) is **not** in scope — the only thing a circle grants is read visibility, exactly as in slice 4.

**Goals:**

- New nullable column `inventory_items.visibility_circle_id INTEGER REFERENCES circles(id) ON DELETE SET NULL` (no default; mirrors slice 4's column shape on `deals` exactly).
- New partial index `inventory_items_visibility_circle_idx ON (visibility_circle_id, org_id) WHERE visibility_circle_id IS NOT NULL` — the hot path of the widened-read query (the right side of the `OR`). Mirrors `deals_visibility_circle_idx` (slice 4 §2.3).
- New helper `getSharedInventoryForOrg(db, orgId): Promise<SharedInventoryRow[]>` in `src/db/inventory.ts` — returns inventory items shared into any circle the viewer's org is in, AUGMENTED with the posting org's display name (denormalized join, like the slice-2 `posted_by_label` pattern but resolved at query time from `orgs.name`).
- `getInventorySummary(db, orgId)` stays single-org-scoped (counts only what the viewer's own org owns) — the summary panel is intentionally not a TradeNet view; cross-circle counts would conflate ownership with availability and confuse the owner's reading of "how much do I have on hand?". The new TradeNet panel and `/exchange` route are the cross-circle surface.
- Extend `updateInventoryItem` server action to accept an optional `visibilityCircleId` Zod field. If set, validate via `isOrgMemberOfCircle(orgId, circleId)` **before** the UPDATE — reject with `ForbiddenError` if the caller's session org is not a member of that circle. The reject discipline mirrors slice 4 (`postDeal`) and slice 4c (every invitation action) exactly. **Self-share is a no-op concept** here — sharing into a circle the owner ISN'T in is the rejection case; sharing into a circle the owner IS in is the intended path.
- Optional new `createInventoryItem` extension: the create form may also accept `visibilityCircleId` (so the owner can share at creation time, not just on edit). Same membership pre-check. (Defaults to `null` / private.)
- `InventoryAdmin` gains a per-row **"Share with circle"** dropdown (default: Private, options: every circle the owner's org is a member of). Submitting the dropdown calls the same `updateInventoryItem` action with the `visibilityCircleId` field. Inline save (no separate "edit" mode); optimistic UI mirrors the slice-4c invite/accept buttons.
- `InventoryAdmin` rows that are currently shared display a **"Shared via [Circle Name]"** badge (mirrors `DealRoomPanel`'s gold pill from slice 4 §6.1).
- New dashboard panel `tradenet-inventory` showing the top N (default 5) items shared into circles the viewer is in. Each row: item name + qty + category + "posted by [org label]". Mirrors `DealRoomPanel`'s shape.
- New admin route `/exchange` (`src/app/(admin)/exchange/page.tsx`) — full TradeNet Inventory view (every shared item across every circle the viewer is in). Sortable / filterable like `/deals` but simpler (this slice ships only the unfiltered list view).
- Demo seed extension: mark 3 of AIYA's seed inventory items as shared with "Trusted Partners" (circle id 201); add 2-3 inventory items "from" Mehta (org id 501) and Saint-Cloud (org id 502) also shared with 201 so AIYA sees a non-empty cross-circle view.
- `/exchange` is added to the middleware matcher and the Nav.
- Tests prove (TDD): (a) reads return own org items shared into circles the viewer is in, never items from circles the viewer is NOT in; (b) writes with an unauthorized `visibilityCircleId` are rejected without DB writes; (c) the zero-circles invariant — an org in zero circles sees nothing on `/exchange` and no rows on the panel; (d) foreign-circle-id rows fall back to "private" in the badge (defense-in-depth); (e) the slice-3 cross-org isolation tests for `inventory_items` stay green (an org in no circles sees only its own data); (f) demo mode short-circuits to seed data on both read paths.

**Non-Goals for Slice 15** (each has a named home — see §10):

Inventory bidding / counter-offers / pricing negotiation, reservations / holds, photo gallery per item, per-item per-org custom pricing, stock reservations across orgs, audit log of cross-circle inventory views, notifications when a partner shares a new item, bulk-share UI ("share all my Diamonds with Trusted Partners"), per-row "remove from circle" beyond setting visibility to `null`, foreign-org inventory mutation (qty / status / delete from a foreign org's row), cross-circle deduplication / canonicalization, mockup 2's "request to buy" inline button (that's slice 18 — bidding-on-inventory), per-circle inventory analytics, real-time inventory feed (WebSocket).

---

## 2. Data Model

### 2.1 New column on `inventory_items`: `visibility_circle_id`

```typescript
// src/db/schema.ts — modify the existing `inventoryItems` table definition
export const inventoryItems = pgTable(
  "inventory_items",
  {
    // … existing columns unchanged …
    visibilityCircleId: integer("visibility_circle_id").references(
      () => circles.id,
      { onDelete: "set null" },
    ),
    // … existing createdAt/updatedAt unchanged …
  },
  (t) => ({
    // NEW (alongside any existing indexes — currently `inventoryItems` has no
    // declared indexes; the org-scoped reads are cheap because the table is
    // small per org and rows already cluster by `org_id` heuristically. We
    // ADD ONE new partial index for the widened read path; we do NOT add any
    // missing indexes that slice 1b-1 didn't ship — that is a separate
    // hardening question).
    visibilityCircleIdx: index("inventory_items_visibility_circle_idx")
      .on(t.visibilityCircleId, t.orgId)
      .where(sql`${t.visibilityCircleId} IS NOT NULL`),
  })
);
```

| Column | Type | Notes |
|---|---|---|
| `visibility_circle_id` | integer NULLABLE → `circles.id` ON DELETE SET NULL | `NULL` = org-private (slice 1b-1 default). Non-null = visible to every org that's a member of the circle. |

**Nullable, no default — the same posture as slice 4 `deals.visibility_circle_id`.** Drizzle's `.notNull()` is intentionally omitted so the column is `NULL` for every existing slice 1b-1 row (current behavior preserved). The admin form sends `null` (or omits the field) by default; only an explicit "Share with circle" selection on the dropdown picks a non-null value.

**`ON DELETE SET NULL`** is the same policy choice as slice 4: if a circle is deleted (slice 4c does NOT ship circle-deletion UI yet, but the FK shape is forward-compatible), historical inventory items shared into it must remain visible **to their owning org only** — not vanish from the owner's ledger. `SET NULL` preserves the row and reverts it to private; `CASCADE` would destroy the inventory record, which is wrong (deleting a circle shouldn't lose AIYA's record of their own stock).

**Partial-index recommendation.** `inventory_items_visibility_circle_idx ON (visibility_circle_id, org_id) WHERE visibility_circle_id IS NOT NULL` — partial-NULL filter keeps the index tiny while every existing slice 1b-1 row stays NULL. Two columns rather than three (no need for `status` / `created_at` desc) because:

- The hot path is `WHERE visibility_circle_id IN (...) AND org_id <> currentOrgId` (the foreign-rows side of the union); `(visibility_circle_id, org_id)` serves both predicates from the leftmost cols. We do NOT add `status` to the index because `inventory_items.status` ('in_stock' / 'reserved' / 'sold') is filtered at the read layer but is not part of the unique-shape composite the slice needs.
- The existing per-org reads (slice 1b-1 `getInventorySummary` with `WHERE org_id = $1 AND status <> 'sold'`) are NOT affected — they don't touch this index at all (their predicate has `visibility_circle_id` unconstrained, so the partial index can't be used; PG falls back to the sequential or any future `(org_id)` btree, which is fine for the small per-org row counts in scope).

PGlite partial-index compatibility is verified by slice 4 (`deals_visibility_circle_idx` uses the exact same partial form). No fallback needed.

### 2.2 Migration (`drizzle/0011_*.sql`)

Generated by `npm run db:generate` after the schema edit. Expected file contents:

1. `ALTER TABLE "inventory_items" ADD COLUMN "visibility_circle_id" integer REFERENCES "circles"("id") ON DELETE SET NULL;`
2. `CREATE INDEX "inventory_items_visibility_circle_idx" ON "inventory_items" ("visibility_circle_id", "org_id") WHERE "visibility_circle_id" IS NOT NULL;`

**Schema-only header** (same convention as slice 4 and slice 4c):

```sql
-- schema-only; no seed data in this migration.
-- inventory_items.visibility_circle_id starts NULL for every existing row;
-- the demo seed lives in src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-06-06-aiya-tradenet-inventory-slice-15.md for context.
```

**Migration order dependency:** `0011_*.sql` runs against a DB that has both `0004_*.sql` (slice 3 `orgs` table + AIYA seed at id=1) and `0005_*.sql` (slice 4 `circles` table) already applied. The new FK `inventory_items.visibility_circle_id → circles.id` is referentially valid only because slice 4 already created `circles`. Schema-only; no INSERTs.

**Rollback:** `DROP INDEX inventory_items_visibility_circle_idx; ALTER TABLE inventory_items DROP COLUMN visibility_circle_id;` — safe; tenanted inventory data untouched (only the optional `visibility_circle_id` column goes; all values were either `NULL` or pointed at a circle that, on rollback, also got dropped).

### 2.3 No changes to `circles` / `circle_members` / `circle_invitations`

Slice 15 is **strictly additive on top of slice 4 and slice 4c's circle graph**. It introduces zero new tables, zero new junction shapes, and zero new mutation paths on the membership graph. Every authz decision flows through the existing `isOrgMemberOfCircle` (slice 4 §3.2) and `getCircleIdsForOrg` (slice 4 §3.1) helpers — same single source of truth.

---

## 3. Server Layer — Read Filter Widening

This is, as in slice 4, the load-bearing security change. Every other change is plumbing.

### 3.1 `getInventorySummary(db, orgId)` — UNCHANGED scope

The existing slice 1b-1 `getInventorySummary` stays **single-org-scoped**: it counts only the viewer's own inventory. The summary panel reads "AIYA has 1,240 rings on hand" — conflating that with "and N rings are visible across Trusted Partners" would mislead the owner about their own holdings. The cross-circle surface lives on the new TradeNet panel + `/exchange` route, not on the existing inventory summary.

**Why not widen the existing helper?** Three reasons:

1. **Semantic mismatch.** A category count is a count of **owned** items. Cross-circle items are not "owned" by the viewer — they're visible. Mixing them in the same number is wrong.
2. **Cost asymmetry.** The summary is called on every dashboard render (1 RSC per home page); the TradeNet view is called on dedicated routes. Adding a JOIN-through-circles-and-orgs to every dashboard request would be a write-time cost paid at read time for no display benefit.
3. **Backwards compatibility.** Slice 1b-1's empty-state contract ("no inventory → honest empty state on the panel") must remain: a viewer with zero owned items but visibility into 50 circle-shared items should still see the empty state on the **Inventory Overview** panel (because they own none), and a non-empty state on the new **TradeNet Inventory** panel. That separation only works if `getInventorySummary` stays single-org.

This is **opposite** to the slice-4 decision (which DID widen `getActiveDeals` directly) because deals have no analogous "own-vs-visible" count semantic — a deal is a deal regardless of who posted it. Inventory has true ownership; deals have only authorship.

### 3.2 `getSharedInventoryForOrg(db, orgId)` — `src/db/inventory.ts` (new)

The new helper, mirroring `getActiveDeals` in shape but returning ITEMS instead of DEALS.

```typescript
import { and, eq, or, ne, inArray, desc, type SQL } from "drizzle-orm";
import { inventoryItems, orgs } from "@/db/schema";
import { getCircleIdsForOrg } from "@/lib/circles/queries";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedSharedInventoryForOrg } from "@/lib/demo/seed";

export interface SharedInventoryRow {
  id: number;
  orgId: number;
  ownerOrgLabel: string;          // denormalized from orgs.name at query time
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: "in_stock" | "reserved" | "sold";
  visibilityCircleId: number;     // never null on this projection
  updatedAt: Date;
}

/** Build the visibility OR clause for slice 15. Returns rows the viewer can
 *  see via the circle membership graph: own org's items (regardless of
 *  visibility) PLUS items from other orgs that are shared into a circle the
 *  viewer is in. When the viewer is in zero circles, returns the bare
 *  slice-3 clause `eq(orgId, viewer)` — byte-identical to slice-3 behavior. */
function inventoryVisibilityClause(orgId: number, circleIds: number[]): SQL {
  if (circleIds.length === 0) {
    return eq(inventoryItems.orgId, orgId);
  }
  return or(
    eq(inventoryItems.orgId, orgId),
    inArray(inventoryItems.visibilityCircleId, circleIds),
  )!;
}

export async function getSharedInventoryForOrg(
  db: Db,
  orgId: number,
  limit: number | null = null,
): Promise<SharedInventoryRow[]> {
  if (isDemoMode()) {
    const rows = getSeedSharedInventoryForOrg(orgId);
    return limit != null ? rows.slice(0, limit) : rows;
  }
  const circleIds = await getCircleIdsForOrg(db, orgId);
  // For the TradeNet view we want **foreign-org rows shared into a circle the
  // viewer is in**. The viewer's own items are already on /inventory and the
  // Inventory Overview panel; surfacing them again on /exchange would just
  // duplicate the owner's view. So we additionally constrain to ne(orgId).
  if (circleIds.length === 0) return []; // zero-circles: nothing shared with you
  const q = db
    .select({
      id: inventoryItems.id,
      orgId: inventoryItems.orgId,
      ownerOrgLabel: orgs.name,
      category: inventoryItems.category,
      name: inventoryItems.name,
      quantity: inventoryItems.quantity,
      status: inventoryItems.status,
      visibilityCircleId: inventoryItems.visibilityCircleId,
      updatedAt: inventoryItems.updatedAt,
    })
    .from(inventoryItems)
    .innerJoin(orgs, eq(orgs.id, inventoryItems.orgId))
    .where(
      and(
        ne(inventoryItems.orgId, orgId),
        inArray(inventoryItems.visibilityCircleId, circleIds),
        ne(inventoryItems.status, "sold"),
      ),
    )
    .orderBy(desc(inventoryItems.updatedAt));
  const rows = limit != null ? await q.limit(limit) : await q;
  // `visibilityCircleId` is constrained by the inArray clause to be non-null
  // (PG's IN(...) returns NULL/falsy for NULL inputs), so the cast is safe.
  return rows as SharedInventoryRow[];
}
```

**Critical invariants:**

1. **Zero-circles preservation.** When `circleIds.length === 0`, the function early-returns `[]`. No `inArray([])`. Same as slice 4's `visibilityClause` discipline. The B5 test "(d) zero-circles regression guard" is the asserting test.
2. **`ne(inventoryItems.orgId, orgId)` excludes the viewer's own items** from the TradeNet view. This is the **explicit** design choice — `/exchange` is "what partners are offering", not "everything I can see". The viewer's own items appear on `/inventory` and the Inventory Overview panel. Without this exclusion, a typical viewer would see their own 1,240 rings duplicated next to 50 partner items on `/exchange`, which would mislead.
3. **`ne(status, "sold")` matches the slice 1b-1 `getInventorySummary` convention** — sold items aren't surfaced for trade. (Future hardening: distinguish "sold" from "withdrawn from circle"; out of scope.)
4. **`inArray(visibilityCircleId, circleIds)` automatically excludes NULL rows** — same as slice 4 §3.3 invariant 3. PG's `IN(...)` returns NULL (falsy) for `NULL IN (...)`. No explicit `IS NOT NULL` guard needed; the partial index's NULL filter (§2.1) is the storage-side mirror.
5. **Denormalized `ownerOrgLabel` from `orgs.name`** — same shape as slice 10's `from_org_label` convention. The viewer sees a human-readable label; the panel doesn't expose `orgId` as a numeric id. The join is cheap (single FK lookup, hot index).

**Demo seam.** Same pattern as `getActiveDeals` — `getSharedInventoryForOrg` short-circuits to `getSeedSharedInventoryForOrg(orgId)` in demo mode. The seed helper does the filtering inline so the demo accurately mirrors the widened-read behavior. See §6.

### 3.3 No change to `getInventorySummary`

For the reasons given in §3.1. The single-org WHERE clause is preserved byte-for-byte.

### 3.4 `formatInventoryVisibility` — `src/lib/inventory/format.ts` (new)

The defense-in-depth UI helper, mirroring `formatDealVisibility` (slice 4 §3.4) exactly:

```typescript
export interface InventoryVisibility {
  kind: "private" | "circle";
  circleName?: string;
}

export function formatInventoryVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): InventoryVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" }; // defensive fall-back
  return { kind: "circle", circleName: name };
}
```

The defensive fall-back is the same name-leak guard as slice 4: if a row was somehow returned with `visibility_circle_id` set to a circle the viewer is NOT in, the badge MUST NOT display the circle's name — that would leak the name to a non-member. The widened query (§3.2) makes this state unreachable in well-formed code; the format helper treats unknown ids as "private" so a future query-path bug can't surface a foreign circle name. Test in §7 asserts it explicitly.

---

## 4. Server Layer — Write-Side Validation

### 4.1 `inventoryItemInput` / `inventoryItemUpdateInput` Zod extensions — `src/lib/inventory/validation.ts` (modified)

**Before (slice 1b-1):**

```typescript
export const inventoryItemInput = z.object({
  category: z.enum(INVENTORY_CATEGORIES),
  name: z.string().min(1).max(160),
  sku: z.string().max(80).optional(),
  quantity: z.number().int().min(0),
  status: z.enum(INVENTORY_STATUSES),
  unitCostCents: cents,
  retailPriceCents: cents,
  metal: z.enum(METALS).optional(),
  weightMg: z.number().int().min(0).optional(),
  caratX100: z.number().int().min(0).optional(),
  cut: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  clarity: z.string().max(40).optional(),
});
```

**After (slice 15):**

```typescript
export const inventoryItemInput = z.object({
  // … existing fields unchanged …
  visibilityCircleId: z.number().int().positive().nullable().optional(),
});

export const inventoryItemUpdateInput = inventoryItemInput.extend({ id: z.number().int() });
```

Zod accepts `undefined`, `null`, or a positive integer. The action's downstream insert/update maps `undefined` → `null` so the DB column lands as `NULL` (private) in both cases. The Zod schema **only enforces shape** — it does not verify that the integer is a circle the caller is allowed to share into. That check is server-side runtime authz (§4.2), deliberately outside the schema, because Zod doesn't have DB access and shouldn't pretend to.

**No `orgId` on either schema.** Slice-3 invariant preserved verbatim.

### 4.2 `updateInventoryItem` runtime authz — `src/lib/inventory/actions.ts` (modified)

```typescript
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import { ForbiddenError } from "@/lib/auth/errors";

// Existing `run` wrapper (slice 1b-1) — extended to map ForbiddenError →
// { ok: false, error: "Forbidden" }. Mirrors slice 4's runWithUser extension.
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/inventory");
    revalidatePath("/exchange");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      console.warn(
        `[inventory] forbidden update by org=${orgId}: ${e.message}`,
      );
      Sentry.captureException(e, { tags: { layer: "inventory-action", reason: "forbidden" } });
      return { ok: false, error: "Forbidden" };
    }
    console.error("[inventory action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "inventory-action" } });
    return { ok: false, error: "Database error" };
  }
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    // Membership pre-check — runs BEFORE the UPDATE so a rejected request
    // writes zero rows. The session orgId (never the wire) is the subject.
    if (input.visibilityCircleId !== undefined && input.visibilityCircleId !== null) {
      const allowed = await isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId);
      if (!allowed) throw new ForbiddenError("Forbidden");
    }
    await db()
      .update(inventoryItems)
      .set({
        ...values(input, orgId),
        visibilityCircleId: input.visibilityCircleId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)));
  });
}
```

**`createInventoryItem` gets the same extension** (so the owner can share at creation time):

```typescript
export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId) => {
    if (input.visibilityCircleId !== undefined && input.visibilityCircleId !== null) {
      const allowed = await isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId);
      if (!allowed) throw new ForbiddenError("Forbidden");
    }
    await db().insert(inventoryItems).values({
      ...values(input, orgId),
      visibilityCircleId: input.visibilityCircleId ?? null,
    });
  });
}
```

The shared `values()` helper is updated to pass through `visibilityCircleId: input.visibilityCircleId ?? null` — but the membership check stays in the action, NOT in `values()`, because the helper is pure data-shaping and the check needs DB + session context.

**Critical invariants (the security gate):**

1. **`orgId` for the row owner is from session, never wire.** Unchanged from slice 3. Confirmed by the absence of `orgId` in `inventoryItemInput`.
2. **`visibilityCircleId` is the one new wire field, and it's validated against actual membership before the UPDATE/INSERT.** The check happens *before* the `db().update`/`insert`, so a rejected request writes zero rows. The test in §7 asserts row count.
3. **The check runs against the session orgId**, never against any value supplied by the caller. `isOrgMemberOfCircle(db(), orgId, input.visibilityCircleId)` passes the session-resolved `orgId` from the wrapper, not anything the client could influence.
4. **Setting `visibilityCircleId` to `null`** reverts a previously-shared item to private. No membership check needed (you can always un-share). Test asserts this.
5. **`deleteInventoryItem` is unchanged.** Same as slice 4 §4.3 — circle visibility does NOT widen update or delete authority. A circle member cannot delete or withdraw a foreign org's inventory item, even if both are in the same circle. The existing slice-3 tenancy enforcement on `WHERE id = $1 AND org_id = currentOrg` stays verbatim.
6. **Audit log on rejection.** The `console.warn` line surfaces every Forbidden attempt with the offending org. Same posture as slice 4 §4.2 invariant 4 — console-only audit; proper audit-log table remains deferred.
7. **Demo mode.** `run` short-circuits on `isDemoMode()` before any of this runs — demo updates return `{ ok: false, error: "Demo mode — changes are disabled" }`.

### 4.3 No new mutation paths for circle membership

Same as slice 4 §4.3 and slice 4c §5 (which IS the membership-mutation slice). Slice 15 adds **zero** new API paths to `circle_members` or `circle_invitations`. Memberships are mutated only through the slice-4c `addOrgToCircle` / `removeOrgFromCircle` primitives. The slice-15 read-widening and write-validation paths both consume the existing membership graph; they never mutate it.

---

## 5. UI Layer

### 5.1 `InventoryAdmin` — `src/components/inventory/InventoryAdmin.tsx` (modified)

Receives a new prop `circles: { id: number; name: string }[]` from the page (populated by `getCirclesForOrg(db, orgId)`). Each row in the inventory list gains:

1. A **"Share with circle"** dropdown.
   - Default value: the row's current `visibilityCircleId` (`null` → "Private").
   - Options: `"Private (your org only)"` + every circle the viewer's org is in.
   - On change → fire `updateInventoryItem({ id, ...allCurrentValues, visibilityCircleId: selected })`.
2. A small **"Shared via [Circle Name]"** badge on rows where `visibilityCircleId != null`, rendered via `formatInventoryVisibility(row.visibilityCircleId, circleNamesById)`. Same gold-pill styling as `DealRoomPanel`'s slice-4 badge.

```tsx
// Inside the items.map((it) => …) row render:
const vis = formatInventoryVisibility(it.visibilityCircleId, circleNamesById);
return (
  <li key={it.id} className="flex items-center justify-between gap-2 py-2">
    <span className="flex-1">{it.name}</span>
    <span className="text-text/50">{it.category}</span>
    <span className="text-text/60">×{it.quantity}</span>
    <span className="text-text/60">{it.status}</span>
    <select
      aria-label={`share ${it.name}`}
      className="bg-bg p-1 text-xs"
      value={it.visibilityCircleId ?? ""}
      onChange={(e) =>
        onShare(it.id, e.target.value ? Number(e.target.value) : null)
      }
    >
      <option value="">Private</option>
      {circles.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
    {vis.kind === "circle" && (
      <span
        className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80"
        title={`Shared with ${vis.circleName}`}
      >
        {vis.circleName}
      </span>
    )}
    <span className="text-text/60">{formatCents(it.retailPriceCents)}</span>
    <button className="text-bad" onClick={() => remove(it.id)}
      aria-label={`delete ${it.name}`}>Delete</button>
  </li>
);
```

`onShare(id, circleId)` calls `updateInventoryItem` with the row's existing field values + the new `visibilityCircleId`. The component preserves the existing simple `useState`-driven form model.

**XSS guard:** `vis.circleName` is rendered as text content (React escapes). `circleNamesById` is built from `getCirclesForOrg(currentOrgId)` so it can only contain circles the viewer is in; even so, `formatInventoryVisibility` returns `kind: "private"` for any unknown id — the badge silently disappears rather than rendering an empty pill or a foreign name. Same XSS discipline as slice 4 §6.1.

**`InventoryRow` type** widens to include `visibilityCircleId: number | null` (so the row's current value is visible to the dropdown).

### 5.2 New panel `TradeNetInventoryPanel` — `src/components/dashboard/TradeNetInventoryPanel.tsx` (new)

Mirrors `DealRoomPanel` (slice 4 §6.1) in shape. Top N (default 5) most-recently-updated shared inventory rows the viewer can see:

```tsx
export function TradeNetInventoryPanel({
  items,
}: {
  items: SharedInventoryRow[];
}) {
  if (items.length === 0) {
    return (
      <Panel title="TradeNet Inventory" testid="panel-tradenet-inventory">
        <p className="text-sm text-text/40">
          No partner inventory shared with you yet.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="TradeNet Inventory" testid="panel-tradenet-inventory">
      <ul className="divide-y divide-text/10 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <span className="text-[10px] uppercase tracking-wider text-text/40">
              {it.category}
            </span>
            <span className="flex-1 truncate text-text/80" title={it.name}>
              {it.name}
            </span>
            <span className="text-text/60">×{it.quantity}</span>
            <span className="text-[10px] text-text/40" title={`Posted by ${it.ownerOrgLabel}`}>
              {it.ownerOrgLabel}
            </span>
            <span className="text-[10px] text-text/40">{timeAgo(it.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
```

**No "Shared via" badge on this panel** — every row IS shared by definition (it wouldn't be in the result set otherwise). The `ownerOrgLabel` carries the same "posted by" provenance as `postedByLabel` on `DealRoomPanel`. The empty state is honest: "No partner inventory shared with you yet" — never a fake number.

**Panel id `tradenet-inventory`** is the canonical id; the title `"TradeNet Inventory"` is the user-facing label. Both are stable. Mirrors the slice-4 §6.8 decision for `tradenet-exchange` / "Deal Room".

### 5.3 New admin route `/exchange` — `src/app/(admin)/exchange/page.tsx` (new)

Full TradeNet Inventory view: every shared item across every circle the viewer is in. No filters this slice (deferred to a future hardening pass; mirrors slice 4's "no filter chips" decision):

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getSharedInventoryForOrg } from "@/db/inventory";
import { getCircleNamesForOrg } from "@/lib/circles/queries";
import { TradeNetInventoryList } from "@/components/inventory/TradeNetInventoryList";

export const dynamic = "force-dynamic";

export default async function ExchangePage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [items, circleNamesById] = await Promise.all([
    getSharedInventoryForOrg(db, orgId, null), // null = no limit
    getCircleNamesForOrg(db, orgId),
  ]);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">TradeNet Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <TradeNetInventoryList items={items} circleNamesById={circleNamesById} />
    </main>
  );
}
```

`TradeNetInventoryList` (new component): the unbounded list version of `TradeNetInventoryPanel`, with the "Shared via [Circle]" badge included on each row (so the viewer can tell which circle a foreign-org item came in through, when they belong to multiple circles).

**Defense in depth on `/exchange`:** even if a viewer who is in zero circles somehow reaches the route, `getSharedInventoryForOrg` returns `[]` (the zero-circles early return), and the page renders an honest "No partner inventory shared with you" empty state. The middleware still requires a valid session; demo mode short-circuits to seed data.

### 5.4 Dashboard page wiring — `src/app/page.tsx` (modified) + `DashboardGrid.tsx` (modified)

The dashboard page already `Promise.all`-fetches several views. Add `getSharedInventoryForOrg(db, orgId, 5)` to the parallel batch and thread the result through to a new `TradeNetInventoryView` in `PanelCtx`.

```typescript
// src/app/page.tsx
const [inv, diamond, deals, website, providerStatus, todaysBidsView, sharedInventory] =
  await Promise.all([
    getInventorySummary(db, orgId),
    // … existing parallel reads …
    getSharedInventoryForOrg(db, orgId, 5),
  ]);

const tradenetInventory = { items: sharedInventory };

return (
  <DashboardGrid
    inventory={inventory}
    diamond={diamond}
    deals={deals}
    website={website}
    providerStatus={providerStatus}
    todaysBids={todaysBidsView}
    tradenetInventory={tradenetInventory}
  />
);
```

### 5.5 `PanelCtx` extension — `src/lib/layout/types.ts` (modified)

```typescript
export interface TradeNetInventoryView {
  items: SharedInventoryRow[];
}

export interface PanelCtx {
  inventory?: InventoryView;
  // … existing …
  tradenetInventory?: TradeNetInventoryView;
}
```

### 5.6 Registry — `src/lib/layout/registry.tsx` (modified)

```typescript
{
  id: "tradenet-inventory",
  title: "TradeNet Inventory",
  defaultSize: 1,
  render: (ctx) =>
    ctx.tradenetInventory
      ? <TradeNetInventoryPanel items={ctx.tradenetInventory.items} />
      : <BusinessPlaceholder title="TradeNet Inventory" testid="panel-tradenet-inventory" />,
},
```

Added after the existing `tradenet-exchange` (Deal Room) entry so the two TradeNet panels cluster visually in the registry.

### 5.7 `/inventory` page wiring — `src/app/(admin)/inventory/page.tsx` (modified)

Parallel-fetch the viewer's circles alongside the existing rows query; thread `circles` and `circleNamesById` into `InventoryAdmin`:

```typescript
export default async function InventoryPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [rows, myCircles] = await Promise.all([
    db.select({ /* existing projection + visibilityCircleId */ })
      .from(inventoryItems)
      .where(eq(inventoryItems.orgId, orgId))
      .orderBy(desc(inventoryItems.updatedAt)),
    getCirclesForOrg(db, orgId),
  ]);
  const circleNamesById = new Map(myCircles.map((c) => [c.id, c.name]));
  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Inventory</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <InventoryAdmin
        items={rows as InventoryRow[]}
        createAction={createInventoryItem}
        updateAction={updateInventoryItem}
        deleteAction={deleteInventoryItem}
        circles={myCircles.map((c) => ({ id: c.id, name: c.name }))}
        circleNamesById={circleNamesById}
      />
    </main>
  );
}
```

Note that `updateAction={updateInventoryItem}` is **new** — slice 1b-1 shipped `createAction` + `deleteAction` only (no edit-in-place); slice 15 needs `updateAction` for the inline share dropdown to work without a separate edit flow. This is a small, surgical addition.

The existing inline select projection on `/inventory` adds `visibilityCircleId: inventoryItems.visibilityCircleId` to the column list (mirroring `/deals` Slice-4 projection extension).

### 5.8 Middleware + Nav

`/exchange` is added to:

- `src/middleware.ts` matcher: append `"/exchange"` next to the existing `"/inventory", "/diamonds", "/deals", "/website", "/circles"` entries.
- `src/components/dashboard/Nav.tsx`:
  - The existing `"TradeNet Exchange"` SECTIONS entry (already in the static array as a non-interactive item) becomes a real link by adding `"TradeNet Exchange": "/exchange"` to `ROUTES`.
  - **Decision:** the existing static label "TradeNet Exchange" matches the route's purpose; no new label added. The Deal Room continues to live at `/deals` under "Orders & Deals". This is the cleanest mapping — TradeNet Exchange becomes the inventory-marketplace surface; Deal Room remains the BUY/SELL ticker surface. Both are distinct mental models.

---

## 6. Demo Mode

### 6.1 Seeded shared inventory

Extend `src/lib/demo/seed.ts` with new exports for the cross-circle inventory view. The slice-4 `DEMO_AIYA_ORG_ID = 1`, `DEMO_TRUSTED_PARTNERS_CIRCLE_ID = 201`, `DEMO_PARTNER_ORG_IDS = { MEHTA: 501, SAINT_CLOUD: 502, MARATHI: 503 }` constants are already exported and STAY UNCHANGED.

```typescript
export interface SeedSharedInventoryRow {
  id: number;
  orgId: number;
  ownerOrgLabel: string;
  category: InventoryCategory;
  name: string;
  quantity: number;
  status: "in_stock" | "reserved" | "sold";
  visibilityCircleId: number;
  updatedAt: Date;
}

const DEMO_INV_REF = new Date("2026-06-06T12:00:00Z").getTime();
const hAgo = (h: number) => new Date(DEMO_INV_REF - h * 60 * 60 * 1000);

/** Inventory items "from" partner orgs, shared into the Trusted Partners
 *  circle. Visible to AIYA via the slice-15 widened read. Demo-only ids in
 *  the 600+ range so they don't collide with AIYA's own slice-1b-1 seeds. */
export function getSeedSharedInventoryRows(): SeedSharedInventoryRow[] {
  return [
    {
      id: 601, orgId: DEMO_PARTNER_ORG_IDS.MEHTA,
      ownerOrgLabel: "Mehta Diamonds — Mumbai",
      category: "Diamonds", name: "Round 2.51ct E/VVS1 GIA — Mumbai cutting — demo · simulated",
      quantity: 1, status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID, updatedAt: hAgo(3),
    },
    {
      id: 602, orgId: DEMO_PARTNER_ORG_IDS.SAINT_CLOUD,
      ownerOrgLabel: "Saint-Cloud Gems — Geneva",
      category: "Gems", name: "Cushion Padparadscha 1.8ct AGL cert — demo · simulated",
      quantity: 1, status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID, updatedAt: hAgo(12),
    },
    {
      id: 603, orgId: DEMO_PARTNER_ORG_IDS.MARATHI,
      ownerOrgLabel: "Marathi Trading — Surat",
      category: "Diamonds", name: "Princess 1.05ct G/SI1 IGI parcel x 50 — demo · simulated",
      quantity: 50, status: "in_stock",
      visibilityCircleId: DEMO_TRUSTED_PARTNERS_CIRCLE_ID, updatedAt: hAgo(30),
    },
  ];
}

/** Demo widening: return rows visible to a given org via the seed graph.
 *  Mirrors getSeedDealsVisibleTo's shape. Critically, EXCLUDES the viewer's
 *  OWN org rows — /exchange is "partners are offering", not "everything I
 *  can see" (same product decision as the real query in §3.2). */
export function getSeedSharedInventoryForOrg(orgId: number): SeedSharedInventoryRow[] {
  const circleIds = new Set(getSeedCircleIdsForOrg(orgId));
  if (circleIds.size === 0) return [];
  return getSeedSharedInventoryRows().filter(
    (r) => r.orgId !== orgId && circleIds.has(r.visibilityCircleId),
  );
}
```

### 6.2 Mark 3 AIYA inventory items as shared

The demo currently seeds `seedInventorySummary` (just COUNTS, no items). Slice 15 introduces a fuller inventory seed shape **only** to back the `/inventory` admin route in demo mode — IF the admin route is even reachable in demo. (Slice 1b-1's demo only ever wires the summary panel, not the admin page.) The implementer's choice:

- **Option A (chosen):** leave the AIYA-own-inventory demo as count-only (`seedInventorySummary` unchanged). The "3-5 AIYA inventory items marked as shared" requirement in the prompt is satisfied by the **partner-org seed rows** — the demo demonstrates the feature from AIYA's perspective (seeing partner inventory on `/exchange`), which is the more compelling story. AIYA marking its own items as shared is a write action; writes are demo-off.
- Option B: add a synthetic `getSeedAiyaSharedInventoryRows()` and wire `/inventory` admin to demo. Strictly more work for marginal demo benefit; deferred.

The implementer goes with **Option A**. The plan explicitly notes that demo-mode reads from `/inventory` continue to surface the slice-1b-1 count summary; demo-mode reads from `/exchange` surface the 3 partner-org seed rows. The demo notice on `/inventory` and `/exchange` (existing slice-2 `DemoNotice` pattern) makes the demo state honest.

### 6.3 Demo seam in `getSharedInventoryForOrg`

```typescript
if (isDemoMode()) {
  const rows = getSeedSharedInventoryForOrg(orgId);
  return limit != null ? rows.slice(0, limit) : rows;
}
```

This is the demo-mode short-circuit, mirroring `getActiveDeals` byte-for-byte.

### 6.4 Demo mode boundaries

| Area | Demo behavior |
|---|---|
| Seed shared inventory rows | Live in `src/lib/demo/seed.ts`; no DB writes. |
| Read widening | `getSharedInventoryForOrg` short-circuits to `getSeedSharedInventoryForOrg(orgId)`. |
| Write attempts (`updateInventoryItem` with `visibilityCircleId`) | Short-circuit at the top of `run` with `{ ok: false, error: "Demo mode — changes are disabled" }`. The membership check never runs. |
| `isOrgMemberOfCircle` | Demo branch: `getSeedCircleIdsForOrg(orgId).includes(circleId)` (slice-4 existing). |
| UI badges | Render against the seed data. Cross-circle rows visibly distinct. |
| `/exchange` route | Wired in demo — shows the 3 partner seed rows. |

The demo demonstrates the feature without ever issuing a real write — the same honesty contract slice 4 and slice 4c hold.

---

## 7. Tests (TDD)

All test files follow the existing pattern: `// @vitest-environment node`, the `vi.mock` discipline from slice 4 / 4c, and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` / `__setTestDb` pattern from `test/helpers/shared-db.ts`. The `seedOrgs()` extension to seed org 888 (added in slice 4) is reused — no further fixture-org additions needed.

### 7.1 `test/db/inventory.test.ts` (extended — the read-side security gate)

The existing slice-1b-1 + slice-3 tenancy tests stay verbatim. Extend with the **visibility truth table** mirroring slice 4 §7.3:

- **Three-org, one-circle scenario.** Orgs (already seeded: 1, 999, 888). Create circle "Trusted Partners" (id=C). Memberships: `(1, C)` and `(888, C)`; no membership for 999. Inventory:
  - I1: owned by 1, `visibility_circle_id = NULL` (private)
  - I2: owned by 1, `visibility_circle_id = C`
  - I3: owned by 999, `visibility_circle_id = NULL`
  - I4: owned by 888, `visibility_circle_id = C`

  Expected for `getSharedInventoryForOrg`:
  - `getSharedInventoryForOrg(db, 1)` returns `[I4]` only — own org (1)'s items are excluded by the `ne(orgId)` clause; 999's item I3 is private; I4 is the only foreign-circle-shared row.
  - `getSharedInventoryForOrg(db, 999)` returns `[]` — 999 is in zero circles.
  - `getSharedInventoryForOrg(db, 888)` returns `[I2]` only — 1 and 888 share circle C, but 888's own I4 is excluded.

- **Multi-circle viewer.** Org 1 in circles A and B; 999 in A only; 888 in B only. Items: IA owned by 999 visible to A; IB owned by 888 visible to B.
  - `getSharedInventoryForOrg(db, 1)` returns `[IA, IB]` — sees both foreign items via the union of A and B.
  - `getSharedInventoryForOrg(db, 999)` returns `[]` — IA is from 999 itself (excluded by `ne`); IB is in B which 999 is NOT in.
  - `getSharedInventoryForOrg(db, 888)` returns `[]` — symmetric.

- **Sold items excluded.** Insert a circle-shared item with `status = 'sold'` → not returned. Preserves slice-1b-1's "sold doesn't count" convention.

- **Zero-circles regression guard — load-bearing.** Org 999 has zero memberships. `getSharedInventoryForOrg(db, 999)` returns `[]` and **does not** issue an `inArray([])` query. Test the early-return contract: spy on `db.select` (or use a vitest mock of the query module) and assert `db.select` is **not** called when `circleIds.length === 0`. This is the slice-4 (d) regression-guard pattern — the EXPLICIT test that an empty membership graph degenerates the query to the slice-3 form (here, "return nothing without touching the DB").

- **`getInventorySummary` unaffected.** Run a slice-3 isolation test verbatim against the slice-15 code: insert items into orgs 1 and 999, call `getInventorySummary(db, 1)` — see only org-1 counts; call with `db, 999` — see only org-999. The widening does NOT touch `getInventorySummary`; this test asserts the §3.1 design decision.

- **Foreign-id fallback in `formatInventoryVisibility`.** Insert an item whose `visibility_circle_id = C_unknown` (a circle the viewer is NOT in). The widened query (`getSharedInventoryForOrg`) excludes it (the `inArray(visibilityCircleId, viewerCircleIds)` filter never matches). The defense-in-depth fallback is asserted in §7.3 below as a unit test on the formatter.

- **Demo mode read.** Set `NEXT_PUBLIC_DEMO_MODE=true`; `getSharedInventoryForOrg(db, DEMO_AIYA_ORG_ID)` returns the 3 seed partner-org rows without touching the DB.

### 7.2 `test/lib/inventory/actions.test.ts` (extended — the write-authz gate)

- **Authorized update sets `visibilityCircleId`.** Seed org 1 + circle C + membership (1, C). Mock `requireSession` to return `{user: "boss", orgId: 1}`. Insert an item I owned by 1. `updateInventoryItem({ id: I.id, ...validFields, visibilityCircleId: C })` returns `{ ok: true }`; the row's `visibility_circle_id` is C.

- **Unauthorized update — not a member.** Seed org 1, circle C, membership (999, C) (org 1 is NOT in C). Session = org 1. `updateInventoryItem({ id: I.id, ...validFields, visibilityCircleId: C })` returns `{ ok: false, error: "Forbidden" }`; **assert zero column changes** — re-select the row, confirm `visibility_circle_id` is still NULL. The UPDATE never ran.

- **Nonexistent circle id.** `updateInventoryItem({ id: I.id, ..., visibilityCircleId: 99999 })` returns `{ ok: false, error: "Forbidden" }` — `isOrgMemberOfCircle` returns false for a circle that doesn't exist; the FK never gets a chance to throw. Defense against id-guessing.

- **Self-share rejection (the spec's wording — "self-share is a no-op").** A more precise framing of the same test: when the caller passes a `visibilityCircleId` to a circle they are NOT in, the request is **rejected with Forbidden** — never silently downgraded to private. Test asserts the row remains in its pre-call state.

- **Null `visibilityCircleId` is always allowed.** Insert a circle-shared item, then `updateInventoryItem({ id: I.id, ..., visibilityCircleId: null })` returns `{ ok: true }`; row reverts to NULL. No membership check is gated on this path.

- **Omitted `visibilityCircleId` preserves existing value.** Tricky: if the action's `values()` helper writes `visibilityCircleId: input.visibilityCircleId ?? null` unconditionally, an `undefined` input would silently set the column to NULL. Spec choice: the action treats `undefined` as "leave unchanged" by only including `visibilityCircleId` in the SET clause when the input field is `defined`. **Test asserts:** `updateInventoryItem({ id: I.id, ...validFields /* no visibilityCircleId */ })` on a previously-shared row PRESERVES the existing `visibility_circle_id`. (This is a UX consideration: editing qty on a shared row shouldn't un-share the item.)

  **Implementation note for the plan:** the `values()` helper must be split such that `visibilityCircleId` is only included in the UPDATE SET clause when `input.visibilityCircleId !== undefined`. For `INSERT`, `undefined` → `null` (the column has no default; insert always sets it).

- **Slice-3 cross-org isolation preserved.** `updateInventoryItem` while session is `{orgId: 999}` updates only org-999's rows — never org 1's, even if the wire payload includes id of a row owned by org 1. The `WHERE id = $1 AND org_id = currentOrg` clause is unchanged from slice 1b-1; the membership check is added BEFORE that clause runs. Test that a session-999 caller attempting to update org-1's row results in zero updates (existing slice-3 invariant), AND that adding a circle-shared `visibilityCircleId` doesn't change this — the `WHERE org_id = 999` still scopes the update to the caller's own rows.

- **`createInventoryItem` authz parity.** Same truth table as `updateInventoryItem` for the visibility field — authorized create succeeds, unauthorized create returns Forbidden with zero rows inserted.

- **`deleteInventoryItem` UNCHANGED.** Verify by running the existing slice-1b-1 delete tests verbatim. No new test needed; the existing tests are the regression guard. A circle member cannot delete a foreign org's item — the slice-3 `WHERE org_id = currentOrg` clause already enforces this.

- **Demo guard.** With `NEXT_PUBLIC_DEMO_MODE=true`, `updateInventoryItem({ ..., visibilityCircleId: 201 })` returns `{ ok: false, error: "Demo mode — changes are disabled" }`. Membership check never runs.

### 7.3 `test/lib/inventory/format.test.ts` (new)

- `formatInventoryVisibility(null, …)` → `{ kind: "private" }`.
- `formatInventoryVisibility(C, mapWithCnamed)` → `{ kind: "circle", circleName: "name" }`.
- `formatInventoryVisibility(C_unknown, emptyMap)` → `{ kind: "private" }` — the foreign-circle-id fallback (defense-in-depth name-leak guard).

### 7.4 `test/components/inventory/InventoryAdmin.test.tsx` (extended)

- Renders the per-row "Share with circle" dropdown with the right default for each row's `visibilityCircleId`.
- Renders the "Shared via [Circle]" badge on rows with a non-null `visibilityCircleId` in the names map.
- **XSS guard:** a `circles` prop containing `name: "<script>alert(1)</script>"` renders as literal text in `textContent`, never as executable HTML. Mirrors slice 4 §7.6 assertion.
- **Name-leak guard:** when a row has `visibilityCircleId = C_unknown` (not in the `circleNamesById` map), the badge renders nothing — no `gold/80` pill in the DOM.
- Changing the dropdown fires `updateAction` with the row's id + the selected `visibilityCircleId` (number or null).

### 7.5 `test/components/dashboard/TradeNetInventoryPanel.test.tsx` (new)

- Empty state when `items=[]` — renders the "No partner inventory shared with you yet" text and the panel testid.
- Renders all rows with category, name, qty, owner label.
- Owner label is rendered as text (XSS); a label of `"<script>alert(1)</script>"` becomes literal text.

### 7.6 Demo seed tests — `test/lib/demo/seed.test.ts` (extended)

- `getSeedSharedInventoryRows()` returns exactly 3 rows with ids 601/602/603, all `visibilityCircleId === DEMO_TRUSTED_PARTNERS_CIRCLE_ID`.
- All seed rows have `orgId` in `Object.values(DEMO_PARTNER_ORG_IDS)` — never AIYA's id (clarifies the §6.2 Option A choice in code).
- All seed subjects/names contain `"demo · simulated"` — honest provenance preserved.
- `getSeedSharedInventoryForOrg(DEMO_AIYA_ORG_ID)` returns the 3 partner rows (AIYA is in circle 201).
- `getSeedSharedInventoryForOrg(999)` returns `[]` (fixture org has no demo memberships).
- `getSeedSharedInventoryForOrg(DEMO_PARTNER_ORG_IDS.MEHTA)` returns 2 rows (the Saint-Cloud + Marathi rows; Mehta's own row 601 is excluded by `ne(orgId)`).

### 7.7 `/exchange` RSC integration — `test/app/exchange.test.tsx` (new)

- Renders the empty state when the viewer is in zero circles.
- Renders the populated list when the viewer is in a circle with shared partner items.
- Calls `getCurrentOrgId()` and `ensureDbReady()` exactly once each.

(Light RSC integration test; mirrors slice 4c's `/circles` RSC test at `test/app/circles.test.tsx`.)

### 7.8 Existing tests stay green

The slice-1b-1 and slice-3 `inventory_items` tenancy tests (`test/db/inventory.test.ts`'s existing cases) **must** pass without modification. The slice-4 `getActiveDeals` widening tests must also stay green (slice 15 doesn't touch deals).

---

## 8. Security & Threat Model

This section follows the slice 4 §8 template verbatim. The risk surface is exactly: **a cross-org read or write that the membership graph would not authorize**.

### 8.1 Tenancy enforcement preserved

The slice-3 invariant — every read scoped to `currentOrgId` — is preserved as the LEFT side of the OR for the slice-15 widened reads (`inventoryVisibilityClause`'s `eq(orgId, ...)` term in the multi-circle branch and the zero-circles fall-through). For the new `getSharedInventoryForOrg`, the design deliberately uses `ne(orgId, ...)` to EXCLUDE the viewer's own items (because `/exchange` is "what partners are offering"), but membership is still gated through `getCircleIdsForOrg(viewer)`. An org in zero circles sees zero foreign items.

The PR review must visually compare the widened WHERE clause to the slice-3 form. Acceptance criterion: every `from(inventoryItems)` outside of `src/db/inventory.ts` (which is the single per-table query module) either filters by `eq(inventoryItems.orgId, sessionOrgId)` or goes through `getSharedInventoryForOrg`.

### 8.2 Read leakage via crafted input

No `orgId` or `circleId` parameters accepted by any read endpoint. `/exchange`'s RSC resolves the viewer's `orgId` from the session via `getCurrentOrgId()`; the panel and route consume the result of `getSharedInventoryForOrg(db, sessionOrgId)`. No URL search params widen visibility this slice.

The PR review's enforcement grep: `grep -rn "circleId\|visibilityCircleId" src/lib/inventory/validation.ts` must show `visibilityCircleId` only as the one new write field and never as a read input.

### 8.3 Auth bypass for write — never trust the body for membership

`visibilityCircleId` is the one new wire field accepted by `updateInventoryItem` and `createInventoryItem`, and it's validated by `isOrgMemberOfCircle(db, sessionOrgId, visibilityCircleId)` **before** the UPDATE/INSERT. The check:

- Runs against the session-resolved `orgId`, not anything the client supplies. Slice 3's invariant preserved.
- Runs BEFORE the database write, so a rejected request writes zero rows. Test asserts row count by re-selecting.
- Throws `ForbiddenError`, which `run` translates to `{ ok: false, error: "Forbidden" }` and a `console.warn` audit log line + Sentry tag.
- Returns false for circle ids that don't exist (defense against id-guessing — the FK never gets a chance to throw).

Equally important: **slice 15 adds no new write paths for circle membership.** Memberships are mutated only through slice 4c's `addOrgToCircle` / `removeOrgFromCircle` primitives. The slice-15 attack surface for circle authorization is well-bounded.

### 8.4 Cross-circle leakage between circles

If AIYA is in Circle A AND Circle B, an inventory item shared into A does NOT appear to a partner who's in B but not A. The §7.1 multi-circle viewer test is the explicit assertion. The widening filter uses the viewer's circle list, never AIYA's.

### 8.5 Sold items

Sold items remain in the table but are hidden from `getSharedInventoryForOrg` (the `ne(status, 'sold')` filter — mirrors slice 1b-1's `getInventorySummary` convention). The widening AND-clauses with the status filter.

### 8.6 Circle name leakage in the UI

`formatInventoryVisibility` returns `kind: "private"` when the row's `visibility_circle_id` is not in the viewer's `circleNamesById` map. Same defense-in-depth as slice 4 §8.6. The map itself is built from `getCirclesForOrg(viewerOrgId)`, which already excludes circles the viewer isn't in. The §7.3 "foreign-id fallback" test is the load-bearing assertion.

### 8.7 JWT integrity

Unchanged. `orgId` stays in the signed JWT payload; the membership graph is server-side. No in-band mechanism for a JWT to lie about circle membership. Identical to slice 4 §8.7.

### 8.8 Owner-label trust

`ownerOrgLabel` on `SharedInventoryRow` is denormalized at query time from `orgs.name` via the inner JOIN. The viewer trusts the join because `orgs.name` is server-controlled (only writable via slice-3 admin paths). If a malicious admin set a partner org's name to `"<script>"`, React's text-children escaping in `TradeNetInventoryPanel` and `TradeNetInventoryList` handles it. The §7.5 XSS assertion is the load-bearing test.

### 8.9 PR review checklist (slice 15 exit gate)

Before merge:

- `grep -rn "from(inventoryItems)" src/` → every match goes through `src/db/inventory.ts` (the per-table query module) OR is a write path that uses `eq(inventoryItems.orgId, sessionOrgId)`. No raw `SELECT * FROM inventory_items` without an org filter outside the module. (One existing exception is the `/inventory` RSC's inline select, which already filters by `eq(orgId, ...)` — that pattern is preserved + extended in this slice to add the visibility column.)
- `grep -rn "circleId\|visibilityCircleId" src/lib/inventory/validation.ts` → matches only `visibilityCircleId` inside `inventoryItemInput`. No read endpoint accepts a circleId.
- `grep -rn "owner_org_id\|ownerOrgId" src/lib/inventory/` → zero matches. Owner-vs-member semantics are NOT used for inventory authorization.
- `isOrgMemberOfCircle` is called from `src/lib/inventory/actions.ts` (inside `updateInventoryItem` and `createInventoryItem`) — both call sites. It is not called from any read path (read uses `getCircleIdsForOrg`).
- The widened `getSharedInventoryForOrg` has an explicit `if (circleIds.length === 0) return []` early return. NO `inArray([])` invocation. (B-phase verification step.)
- The slice-3 cross-org isolation tests (`test/db/inventory.test.ts`'s existing cases) pass without modification.
- The slice-4 / slice-4c widening tests stay green.
- `npm run build` and `npm test` green.

### 8.10 Race conditions

A circle membership row could in principle be deleted between the `isOrgMemberOfCircle` check and the `UPDATE inventory_items` SET clause. In that window, an item would be marked with a `visibility_circle_id` that the owner org is no longer a member of. The consequence is the owner's own widened-read query would still see the item (the LEFT side of the `OR` matches own-org rows), and partners would NOT see it (the membership lookup at read time excludes them).

This is **not** a security issue (the membership loss is in good faith; the item stays org-owned and visible to the owner), but it's a soft UX wart — the owner sees a "Shared via [Circle]" badge on a row they can no longer un-share via the dropdown (the dropdown only lists their current circles). Acceptable for this slice. The cleanup path is "set visibility to null", which works for any value of `visibility_circle_id` (no membership check needed for the un-share path).

When/if a future slice adds bulk membership mutations, that slice's design must explicitly consider whether to (a) accept the soft wart, (b) sweep inventory `visibility_circle_id` to NULL on membership-leave, or (c) wrap the membership-leave in a transaction that also nulls the column. Slice 15 does NOT make this call — it's a slice-4c+ hardening question.

### 8.11 Demo mode

Seeded shared inventory rows exist in the demo runtime but cannot be mutated (the `run` short-circuit at the top kills every write before it reaches the membership check). No UI path bypasses the demo guard — the InventoryAdmin dropdown's onChange still calls `updateInventoryItem`, which still returns the demo-disabled error first.

The demo widening (`getSeedSharedInventoryForOrg`) mirrors the real query's WHERE clause shape. A bug here would be a demo-only display issue, never a real-data leak.

### 8.12 Audit logging — explicit gap

Slice 15 adds two new `console.warn` audit lines (one for create-rejected, one for update-rejected) plus the existing Sentry capture. No new audit table. Inherits slice 4's deferred-audit-log posture.

---

## 9. File Plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/format.ts` | `formatInventoryVisibility` + `InventoryVisibility` type |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/TradeNetInventoryPanel.tsx` | Dashboard panel (top-N TradeNet inventory) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/TradeNetInventoryList.tsx` | Full unbounded list for `/exchange` (re-uses panel row shape) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/exchange/page.tsx` | RSC route — TradeNet Inventory full view |
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0011_*.sql` | Migration: ALTER TABLE inventory_items ADD COLUMN visibility_circle_id + partial index |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/format.test.ts` | `formatInventoryVisibility` truth table + name-leak guard |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/visibility.test.ts` | Visibility-clause unit tests including the load-bearing zero-circles regression guard |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/dashboard/TradeNetInventoryPanel.test.tsx` | Panel render + empty + XSS |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/app/exchange.test.tsx` | RSC integration for `/exchange` |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add nullable `visibilityCircleId` column + `inventory_items_visibility_circle_idx` partial index to `inventoryItems` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/inventory.ts` | Add `SharedInventoryRow` type, `inventoryVisibilityClause`, and `getSharedInventoryForOrg` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/validation.ts` | Add `visibilityCircleId: z.number().int().positive().nullable().optional()` to `inventoryItemInput` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/inventory/actions.ts` | Import `isOrgMemberOfCircle` + `ForbiddenError`; add membership pre-check in `updateInventoryItem` and `createInventoryItem`; map `ForbiddenError → { ok: false, error: "Forbidden" }` in `run`'s catch; thread `visibilityCircleId` into INSERT/UPDATE (with the "undefined preserves" rule for UPDATE) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/inventory/InventoryAdmin.tsx` | Accept `circles`, `circleNamesById`, `updateAction` props; render per-row dropdown + badge; `InventoryRow` type gains `visibilityCircleId: number \| null` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/inventory/page.tsx` | Parallel-fetch `getCirclesForOrg`; build `circleNamesById`; pass `updateInventoryItem` and `circles` into `InventoryAdmin`; extend inline projection with `visibilityCircleId` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/page.tsx` | Parallel-fetch `getSharedInventoryForOrg(db, orgId, 5)`; pass `tradenetInventory={{ items }}` to `DashboardGrid` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/DashboardGrid.tsx` | Add `tradenetInventory?: TradeNetInventoryView` prop; thread into `useMemo` panel ctx |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/types.ts` | Add `TradeNetInventoryView` interface; widen `PanelCtx` with optional field |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/layout/registry.tsx` | Add `tradenet-inventory` panel entry after `tradenet-exchange` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `getSeedSharedInventoryRows`, `getSeedSharedInventoryForOrg`, `SeedSharedInventoryRow` type, demo ref instant |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/middleware.ts` | Add `"/exchange"` to matcher |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/Nav.tsx` | Add `"TradeNet Exchange": "/exchange"` to `ROUTES` (the SECTIONS array already contains the label) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/inventory.test.ts` | Extend with §7.1 truth-table + zero-circles regression guard + `getInventorySummary`-unaffected tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/inventory/actions.test.ts` | Add §7.2 authorized/unauthorized/nonexistent-circle/null/omitted/preserved tests for update and create |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/components/inventory/InventoryAdmin.test.tsx` | Add §7.4 dropdown + badge + XSS + name-leak tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend with §7.6 shared-inventory seed assertions |

### Removed files

None.

---

## 10. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| Inventory bidding / counter-offers / pricing negotiation | Slice 18 — Bidding on Inventory (builds on slice 16) |
| Reservations / holds across orgs | Inventory hardening slice (TBD) |
| Photo gallery per inventory item | Photos hardening slice (slice 17 lays groundwork on deals) |
| Per-item per-org custom pricing | Pricing slice (TBD) |
| Stock reservations across orgs | Inventory hardening slice (TBD) |
| Audit log of cross-circle inventory views | Tenancy audit log slice (descended from slice 3 §10) |
| Notifications when a partner shares a new item | Notifications slice (TBD) |
| Bulk-share UI ("share all my Diamonds with Trusted Partners") | Inventory hardening slice (TBD) |
| Foreign-org inventory mutation (qty / status / delete) | Out of scope by design — only read visibility is widened |
| Cross-circle deduplication / canonicalization | Inventory hardening slice (TBD) |
| Mockup 2 "request to buy" inline button | Slice 18 — Bidding on Inventory |
| Per-circle inventory analytics | Reports slice (TBD) |
| Real-time inventory feed (WebSocket) | Live feed slice (TBD; descended from slice 2f) |
| Inventory filter chips on `/exchange` (status / category / org) | `/exchange` hardening (TBD) |
| Sweep inventory `visibility_circle_id` to NULL on membership-leave | Slice-4c+ hardening (race-condition resolution; §8.10) |
| Public marketplace inventory (visible to ALL orgs) | TBD — would extend `visibility_circle_id` semantics with a sentinel; deliberately not built |
| `/exchange/[itemId]` deep-link view | Slice 17 / inventory detail hardening |

---
