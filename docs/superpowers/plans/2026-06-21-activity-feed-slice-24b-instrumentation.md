# Slice 24b — Activity Feed: remaining action instrumentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the slice 24 B1 pattern to the remaining mutation surfaces so every audit-worthy action emits an `activity_events` row. No UI in this slice — UI is slice 24c.

**Architecture:** Same as slice 24 B1: inside each action handler's success path, call `recordActivitySafely(db, { orgId, actor, entityType, entityId, verb, summary, payload }, { action: "<tag>" })` after the mutation commits, before the return. Failure is swallowed and Sentry-tagged; audit failure never blocks business operation.

**Tech Stack:** No new dependencies. Reuses `recordActivitySafely` + the `ActivityEntityType` / `ActivityVerb` whitelists shipped in slice 24.

**Spec:** `docs/superpowers/specs/2026-06-20-activity-feed-slice-24-design.md`

**Branch:** `feature/slice-24b-activity-ui` at `.worktrees/slice-24b-activity-ui/`

**Working directory for every shell command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-24b-activity-ui`

## File map

**Modified in this slice:**
- `src/lib/deals/actions.ts` — instrument 5 mutation handlers
- `src/lib/circles/actions.ts` — instrument 6 mutation handlers
- `src/lib/inventory/actions.ts` — instrument 7 mutation handlers
- `test/lib/deals/*.test.ts` — extend happy-path assertions
- `test/lib/circles/*.test.ts` — extend happy-path assertions
- `test/lib/inventory/*.test.ts` — extend happy-path assertions

**Not touched:** `src/lib/company/actions.ts` (KPI panels, primarily seed-driven — separate slice if warranted), `src/lib/diamonds/actions.ts` (AIYA-module-specific, defers to when AIYA module boundary is clean), `src/lib/website/actions.ts` (snapshot ingestion, primarily automated).

## Instrumentation pattern (reference for every task)

For any successful mutation `M` on entity `E` (id `eid`), call this from inside `runWith*(action, fn)` after the mutation commits:

```ts
await recordActivitySafely(
  db,
  {
    orgId: session.orgId,
    actor: session.user,
    entityType: "<E>",              // one of ACTIVITY_ENTITY_TYPES
    entityId: eid,
    verb: "<V>",                    // one of ACTIVITY_VERBS
    summary: `<past-tense sentence>`,
    payload: { /* small structured context; NOT the full row */ },
  },
  { action: "<action-tag>" },
);
```

Rules:
- Summary format: "Added Foo", "Updated Foo", "Deleted Foo", "Placed bid on Foo", "Accepted Y's bid on Foo", etc. Use the SUMMARY PHRASING conventions in the spec §5.1 — do NOT include the entity-type word.
- Payload: MUST be small — 4 KB cap enforced downstream. Include only fields the UI needs to render a diff or explanation. Never dump the whole row.
- Import `recordActivitySafely` from `@/lib/activity/recordActivitySafely` at the top of the file.
- If the file's local `run()` helper doesn't yet thread `actor: string` (some do — customers/actions.ts does after slice 24 B1 — some may not), widen the callback type + capture `session.user` from `requireSession()`. Look at `src/lib/customers/actions.ts` for the reference shape.

---

## Task 24b-1 — Instrument `src/lib/deals/actions.ts`

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Modify: at minimum one deals test file (see step 6 for which)

- [ ] **Step 1: Survey the file**

```bash
grep -n "^export async function\|action:" src/lib/deals/actions.ts | head -30
```

Understand the current handler signatures + which wrap in a local `run()` / `runWithUser()` helper + which take `session.user`.

- [ ] **Step 2: Import the helper**

Add near the existing imports at the top of `src/lib/deals/actions.ts`:

```ts
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";
```

- [ ] **Step 3: Widen the local action-runner to pass `actor` if it doesn't already**

If the file has a local `run<T>()` helper (or `runWithUser`) that only passes `orgId` to the callback, widen the callback signature to also pass `actor: string` from `session.user`. Mirror the change in `src/lib/customers/actions.ts` (commit `34894a1`) — the diff there is the template.

If the helper already passes user/actor, skip this step.

- [ ] **Step 4: Instrument these 5 handlers with `recordActivitySafely`**

Insert `await recordActivitySafely(...)` inside each handler after the DB mutation succeeds and before the return. For each, pick the entityType and verb from these tables:

| Handler | entityType | verb | Summary template | Payload fields |
|---|---|---|---|---|
| `postDeal` | `"deal"` | `"created"` | `` `Posted ${side} ${category}` `` (e.g. "Posted BUY Diamond") | `{ side, category, title }` — pull from parsed input |
| `markDealFilled` | `"deal"` | `"updated"` | `` `Marked deal #${id} filled` `` | `{ status: "filled" }` |
| `withdrawDeal` | `"deal"` | `"archived"` | `` `Withdrew deal #${id}` `` | `{ status: "withdrawn" }` |
| `postDealMessage` | `"deal"` | `"commented"` | `` `Replied on deal #${dealId}` `` | `{ dealId, messageLen: body.length }` |
| `deleteDealMessage` | `"deal"` | `"comment_deleted"` | `` `Deleted a reply on deal #${dealId}` `` | `{ dealId, messageId }` |

`setDealThreadMode` and `markDealThreadRead` are UI-state mutations — SKIP them (not audit-worthy). This is intentional; document with a one-line comment above each handler: `// intentionally not audited — UI state only`.

The `action` tag in the `ctx` argument should follow `"deals.<handler-verb>"`:
- `postDeal` → `"deals.post"`
- `markDealFilled` → `"deals.markFilled"`
- `withdrawDeal` → `"deals.withdraw"`
- `postDealMessage` → `"deals.postMessage"`
- `deleteDealMessage` → `"deals.deleteMessage"`

- [ ] **Step 5: tsc sanity**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: exit 0.

- [ ] **Step 6: Extend one deals test file per instrumented handler**

For each of the 5 instrumented handlers, find the corresponding happy-path test (usually in `test/lib/deals/*.test.ts` — the file layout varies per handler). For the FIRST successful-happy-path test of each handler, append:

```ts
const [actRow] = await db
  .select()
  .from(activityEvents)
  .where(and(eq(activityEvents.entityType, "deal"), eq(activityEvents.verb, "<expected-verb>")))
  .orderBy(desc(activityEvents.id));
expect(actRow).toMatchObject({ orgId: <orgId>, actor: "<test-user-string>", entityType: "deal", verb: "<expected-verb>" });
```

Adjust `<expected-verb>`, `<orgId>`, `<test-user-string>` per test. If the test file doesn't yet import `activityEvents`, `and`, `eq`, `desc`, add them:

```ts
import { activityEvents } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
```

Add ONE assertion per handler — not multiple copies of the same assertion. This costs 5 extra assertions total.

- [ ] **Step 7: Run the affected test files**

```bash
npx vitest run test/lib/deals/; echo "EXIT=$?"
```

Expected: all existing tests still pass + your new assertions pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/deals/actions.ts test/lib/deals/
git commit -m "feat(deals): emit activity events on 5 mutations (slice 24b-1)"
```

## Report format

After each task, report:
- Status
- Files changed
- Raw vitest output for the affected tests, with `; echo "EXIT=$?"` at the end
- Raw tsc output
- Commit SHA
- Which handlers you instrumented + which you skipped + why
- Any surprises

---

## Task 24b-2 — Instrument `src/lib/circles/actions.ts`

**Files:**
- Modify: `src/lib/circles/actions.ts`
- Modify: at least one circles test file

- [ ] **Step 1: Survey the file** (same shape as 24b-1 Step 1)

```bash
grep -n "^export async function\|action:" src/lib/circles/actions.ts | head -20
```

- [ ] **Step 2: Import + widen runner if needed** (same pattern as 24b-1)

- [ ] **Step 3: Instrument these 6 handlers**

| Handler | entityType | verb | Summary template | Payload fields | action tag |
|---|---|---|---|---|---|
| `createCircle` | `"circle"` | `"created"` | `` `Created circle "${name}"` `` | `{ name, slug }` | `"circles.create"` |
| `inviteOrgToCircle` | `"circle"` | `"invited"` | `` `Invited ${toSlug} to "${circleName}"` `` | `{ circleId, toSlug }` | `"circles.invite"` |
| `acceptInvitation` | `"circle"` | `"joined"` | `` `Accepted invite to "${circleName}"` `` | `{ circleId, fromOrgSlug }` | `"circles.acceptInvite"` |
| `declineInvitation` | `"circle"` | `"deleted"` | `` `Declined invite to "${circleName}"` `` | `{ circleId, fromOrgSlug }` | `"circles.declineInvite"` |
| `removeOrgFromCircle` | `"circle"` | `"left"` | `` `Removed ${slug} from "${circleName}"` `` | `{ circleId, removedOrgSlug }` | `"circles.remove"` |
| `leaveCircle` | `"circle"` | `"left"` | `` `Left circle "${circleName}"` `` | `{ circleId }` | `"circles.leave"` |

Note: `declineInvitation` uses `"deleted"` verb — the invite row is soft-deleted. This is the closest whitelist match; open a follow-up chip if a `declined` verb is added later.

- [ ] **Step 4: tsc + test + commit** (mirror 24b-1 steps 5-8)

Test assertion pattern (append to first happy-path per handler):

```ts
const [actRow] = await db
  .select()
  .from(activityEvents)
  .where(and(eq(activityEvents.entityType, "circle"), eq(activityEvents.verb, "<expected-verb>")))
  .orderBy(desc(activityEvents.id));
expect(actRow).toMatchObject({ orgId: <orgId>, entityType: "circle", verb: "<expected-verb>" });
```

Commit message:
```
feat(circles): emit activity events on 6 mutations (slice 24b-2)
```

---

## Task 24b-3 — Instrument `src/lib/inventory/actions.ts`

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Modify: at least one inventory test file

- [ ] **Step 1: Survey the file**

```bash
grep -n "^export async function\|action:" src/lib/inventory/actions.ts | head -20
```

- [ ] **Step 2: Import + widen runner if needed**

- [ ] **Step 3: Instrument these 7 handlers**

| Handler | entityType | verb | Summary template | Payload fields | action tag |
|---|---|---|---|---|---|
| `createInventoryItem` | `"inventory_item"` | `"created"` | `` `Added "${name}"` `` | `{ name, category, quantity }` | `"inventory.create"` |
| `updateInventoryItem` | `"inventory_item"` | `"updated"` | `` `Updated "${name}"` `` (or use `changedFields[0]` when there's exactly one) | `{ changedFields }` | `"inventory.update"` |
| `deleteInventoryItem` | `"inventory_item"` | `"deleted"` | `` `Deleted "${name}"` `` | `{ name, category }` | `"inventory.delete"` |
| `postInventoryBid` | `"bid"` | `"bid_placed"` | `` `Placed bid on "${itemName}"` `` | `{ inventoryItemId, pricePerUnit, quantityRequested }` | `"inventory.bid.place"` |
| `acceptInventoryBid` | `"bid"` | `"bid_accepted"` | `` `Accepted ${bidderOrgSlug}'s bid on "${itemName}"` `` | `{ inventoryItemId, bidId, quantityAccepted }` | `"inventory.bid.accept"` |
| `rejectInventoryBid` | `"bid"` | `"bid_rejected"` | `` `Rejected ${bidderOrgSlug}'s bid on "${itemName}"` `` | `{ inventoryItemId, bidId }` | `"inventory.bid.reject"` |
| `withdrawInventoryBid` | `"bid"` | `"bid_withdrawn"` | `` `Withdrew bid on "${itemName}"` `` | `{ inventoryItemId, bidId }` | `"inventory.bid.withdraw"` |

Notes:
- For `createInventoryItem`, `updateInventoryItem`, `deleteInventoryItem`, follow the `customers/actions.ts` pattern exactly.
- For the four bid handlers, the entityType is `"bid"` (NOT `"inventory_item"`) — the bid IS the audit-worthy entity. `payload.inventoryItemId` connects the bid audit row to the item.
- `changedFields` for `updateInventoryItem` follows the same pattern as `updateCustomer` (slice 24 B1): `Object.keys(input).filter((k) => k !== "id")`.
- If `withdrawInventoryBid` doesn't have `itemName` accessible in scope after the mutation (i.e. the DELETE returns just the bid row), pull the item name via a separate `select` on `inventoryItems` before the delete — use the existing pre-check pattern in the handler.

- [ ] **Step 4: tsc + tests + commit** (same shape)

Commit message:
```
feat(inventory): emit activity events on 7 mutations (slice 24b-3)
```

---

## After all three tasks: full-suite verification

```bash
rm -f /tmp/slice24b-final-vitest.log /tmp/slice24b-final-vitest.done
nohup bash -c 'npx vitest run > /tmp/slice24b-final-vitest.log 2>&1; echo "VITEST_EXIT=$?" > /tmp/slice24b-final-vitest.done' > /dev/null 2>&1 & disown
until [ -f /tmp/slice24b-final-vitest.done ]; do sleep 15; done
cat /tmp/slice24b-final-vitest.done
grep -E "^Test Files|^      Tests|FAIL" /tmp/slice24b-final-vitest.log | tail -10
```

Expected: `VITEST_EXIT=0`, "Test Files NN passed (NN)" "Tests MMM passed (MMM)". Total should be ~1106 baseline + ~18 new assertions ≈ 1124.

## Done condition

- 3 commits, one per action file
- Full vitest green (`VITEST_EXIT=0`)
- tsc --noEmit exit 0
- No new files created (except test extensions to existing files) — this slice is pure instrumentation
- Ready to merge to main + queue slice 24c
