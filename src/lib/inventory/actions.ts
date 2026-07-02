"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { inventoryItems, inventoryBids, orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
import {
  inventoryItemInput,
  inventoryItemUpdateInput,
  firstZodError,
  type InventoryItemInput,
} from "./validation";
import {
  postInventoryBidInput,
  acceptInventoryBidInput,
  rejectInventoryBidInput,
  withdrawInventoryBidInput,
  setInventoryItemBidModeInput,
} from "./bidValidation";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors the company actions pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw to the UI.
 *  Widened in slice 24b-3 to also thread `actor: string` (session.user) to the
 *  callback, so mutation sites can call recordActivitySafely without a second
 *  requireSession() round-trip. Mirrors src/lib/deals/actions.ts `run<T>()`
 *  (post-24b-1) and src/lib/customers/actions.ts `run<T>()`. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number, actor: string) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  let actor: string;
  try {
    const session = await requireSession();
    orgId = session.orgId;
    actor = session.user;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId, actor);
    revalidatePath("/");
    revalidatePath("/inventory");
    revalidatePath("/exchange");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      console.warn(`[inventory] forbidden update by org=${orgId}: ${e.message}`);
      Sentry.captureException(e, { tags: { layer: "inventory-action", reason: "forbidden" } });
      return { ok: false, error: "Forbidden" };
    }
    console.error("[inventory action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "inventory-action" } });
    return { ok: false, error: "Database error" };
  }
}

function baseValues(input: InventoryItemInput, orgId: number) {
  return {
    orgId,
    category: input.category,
    name: input.name,
    sku: input.sku ?? null,
    quantity: input.quantity,
    status: input.status,
    unitCostCents: input.unitCostCents,
    retailPriceCents: input.retailPriceCents,
    metal: input.metal ?? null,
    weightMg: input.weightMg ?? null,
    caratX100: input.caratX100 ?? null,
    cut: input.cut ?? null,
    color: input.color ?? null,
    clarity: input.clarity ?? null,
  };
}

/** For UPDATE: only include visibilityCircleId in the SET clause when the
 *  input explicitly provided a value. Editing qty on a shared row must NOT
 *  silently un-share the item. */
function updateValues(input: InventoryItemInput, orgId: number) {
  const base = baseValues(input, orgId);
  if (!("visibilityCircleId" in input) || input.visibilityCircleId === undefined) return base;
  return { ...base, visibilityCircleId: input.visibilityCircleId ?? null };
}

/** For INSERT: visibilityCircleId is always set (NULL if undefined or null). */
function insertValues(input: InventoryItemInput, orgId: number) {
  return {
    ...baseValues(input, orgId),
    visibilityCircleId: input.visibilityCircleId ?? null,
  };
}

/** Slice 15 membership pre-check. Runs BEFORE any UPDATE/INSERT. The
 *  authoritative orgId is the session's, NEVER the wire. A `null` or
 *  `undefined` visibility is a no-op (un-share or preserve respectively).
 *  Throws ForbiddenError when the session org is not a member of the
 *  requested circle — `run` catches and maps to { ok: false, error: "Forbidden" }. */
async function ensureCanShare(
  orgId: number,
  visibilityCircleId: number | null | undefined,
): Promise<void> {
  if (visibilityCircleId === undefined || visibilityCircleId === null) return;
  const allowed = await isOrgMemberOfCircle(db(), orgId, visibilityCircleId);
  if (!allowed) throw new ForbiddenError("Forbidden");
}

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId, actor) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    const [row] = await db()
      .insert(inventoryItems)
      .values(insertValues(input, orgId))
      .returning();
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor,
        entityType: "inventory_item",
        entityId: row.id,
        verb: "created",
        summary: `Added "${row.name}"`,
        payload: { name: row.name, category: row.category, quantity: row.quantity },
      },
      { action: "inventory.create" },
    );
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId, actor) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    const res = await db()
      .update(inventoryItems)
      .set({ ...updateValues(input, orgId), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)))
      .returning();
    // Cross-org id (defense-in-depth WHERE) → zero rows touched. Slice-3
    // convention: silent no-op, action still returns { ok: true }. Nothing
    // real happened, so skip the audit — mirrors circles/actions.ts's
    // `removed.length === 0` gate post-24b-2.
    if (res.length === 0) return;
    const updated = res[0]!;
    const changedFields = Object.keys(input).filter((k) => k !== "id");
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor,
        entityType: "inventory_item",
        entityId: input.id,
        verb: "updated",
        summary:
          changedFields.length === 1
            ? `Updated "${updated.name}": ${changedFields[0]}`
            : `Updated "${updated.name}"`,
        payload: { changedFields },
      },
      { action: "inventory.update" },
    );
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId, actor) => {
    const res = await db()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, rid), eq(inventoryItems.orgId, orgId)))
      .returning();
    // Cross-org id → zero rows deleted; silent no-op, skip the audit.
    if (res.length === 0) return;
    const deleted = res[0]!;
    await recordActivitySafely(
      db(),
      {
        orgId,
        actor,
        entityType: "inventory_item",
        entityId: rid,
        verb: "deleted",
        summary: `Deleted "${deleted.name}"`,
        payload: { name: deleted.name, category: deleted.category },
      },
      { action: "inventory.delete" },
    );
  });
}

/** Slice-18 + 18b write-side gate: can the caller bid on this inventory item?
 *  Six preconditions, evaluated in order. ALL must pass:
 *    1. Item exists.
 *    2. Caller is NOT the item owner (self-bid block).
 *    3. Item's bid_mode is non-null (owner has enabled bidding).
 *    4. Item has a visibility_circle_id (private items are non-biddable
 *       except by owner — but owner is rejected at step 2; combination is
 *       Forbidden by construction).
 *    5. Caller is a member of the item's visibility circle.
 *    6. (Slice 18b) input.quantityRequested <= item.quantity AT POST TIME.
 *       UX guard only — the accept-side check inside the locked tx is the
 *       source of truth (stock can change between post and accept).
 *
 *  The 6th check sits AFTER membership for no-info-leak: a non-member who
 *  happens to over-stock gets the same Forbidden as a member who over-stocks.
 *
 *  ⚠ Mirrors getInventoryBidsForItem's bidder|owner SQL visibility, with
 *  the added "no self-bidding" + "bid_mode non-null" + "must be circle
 *  member" rules. If you change visibility in either place, change both. */
async function canBidOnItem(
  d: Db,
  orgId: number,
  inventoryItemId: number,
  quantityRequested: number,
): Promise<
  | {
      ok: true;
      ownerOrgId: number;
      bidMode: "single" | "history";
      visibilityCircleId: number;
      // Slice 24b-3: item name for the bid-placed audit summary. Added to
      // this existing authz SELECT rather than a second round-trip.
      itemName: string;
    }
  | { ok: false }
> {
  const [row] = await d
    .select({
      ownerOrgId: inventoryItems.orgId,
      bidMode: inventoryItems.bidMode,
      visibilityCircleId: inventoryItems.visibilityCircleId,
      quantity: inventoryItems.quantity,
      name: inventoryItems.name,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.ownerOrgId === orgId) return { ok: false };
  if (row.bidMode === null) return { ok: false };
  if (row.visibilityCircleId === null) return { ok: false };
  const isMember = await isOrgMemberOfCircle(d, orgId, row.visibilityCircleId);
  if (!isMember) return { ok: false };
  if (quantityRequested > row.quantity) return { ok: false };
  return {
    ok: true,
    ownerOrgId: row.ownerOrgId,
    itemName: row.name,
    bidMode: row.bidMode,
    visibilityCircleId: row.visibilityCircleId,
  };
}

export async function postInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(postInventoryBidInput, raw, async (input, orgId, actor) => {
    const d = db();
    const access = await canBidOnItem(d, orgId, input.inventoryItemId, input.quantityRequested);
    if (!access.ok) throw new ForbiddenError("Forbidden");
    const label = await resolveOrgLabel(d, orgId);
    const [row] = await d
      .insert(inventoryBids)
      .values({
        inventoryItemId: input.inventoryItemId,
        bidderOrgId: orgId,
        bidderOrgLabel: label,
        priceCents: input.priceCents,
        currency: input.currency,
        notes: input.notes ?? null,
        quantityRequested: input.quantityRequested,
      })
      .returning();
    await recordActivitySafely(
      d,
      {
        orgId,
        actor,
        entityType: "bid",
        entityId: row.id,
        verb: "bid_placed",
        summary: `Placed bid on "${access.itemName}"`,
        payload: {
          inventoryItemId: input.inventoryItemId,
          pricePerUnit: input.priceCents,
          quantityRequested: input.quantityRequested,
        },
      },
      { action: "inventory.bid.place" },
    );
  });
}

export async function acceptInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(acceptInventoryBidInput, raw, async (input, orgId, actor) => {
    const d = db();
    const [row] = await d
      .select({
        bidId: inventoryBids.id,
        bidStatus: inventoryBids.status,
        inventoryItemId: inventoryBids.inventoryItemId,
        itemOwnerOrgId: inventoryItems.orgId,
        // Slice 24b-3: item name + bidder org slug for the bid-accepted audit
        // summary. Both riding on this existing authz SELECT's join — bidder
        // org is reached via a second join, no extra round-trip.
        itemName: inventoryItems.name,
        bidderOrgSlug: orgs.slug,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .innerJoin(orgs, eq(orgs.id, inventoryBids.bidderOrgId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");

    const now = new Date();
    // Slice 24b-3: quantity actually accepted, captured from inside the
    // locked tx (the re-read's `bid_qty`) so the audit payload reflects the
    // value that was actually committed, not a possibly-stale pre-tx read.
    let quantityAccepted = 0;
    await d.transaction(async (tx) => {
      // Serialize concurrent accepts on the SAME item by taking a row-lock on
      // the parent inventory_item. Two acceptInventoryBid() calls in flight on
      // different bids of the same item will queue at this SELECT FOR UPDATE
      // — only one tx holds the lock at a time. Without this, each tx's
      // snapshot sees the other's bid as still 'pending' and both UPDATEs
      // succeed → double-accept. Caught by the spec §9.3 concurrent-accept
      // test in bid-accept-atomicity.test.ts. Slice 16's acceptBid uses
      // the identical pattern on deals (commit aed4591); keep them in sync.
      await tx.execute(
        sql`SELECT id FROM inventory_items WHERE id = ${row.inventoryItemId} FOR UPDATE`,
      );

      // Re-read bid status + FRESH item.quantity inside the locked tx. The
      // slice-18 re-read only checked bid.status; slice 18b ALSO reads
      // item.quantity (and the bid's quantity_requested) because a prior
      // accept on this same item — racing with us — may have decremented
      // stock below what this bid asked for.
      const fresh = await tx.execute(sql`
        SELECT ib.status AS bid_status,
               ib.quantity_requested AS bid_qty,
               i.quantity AS item_qty
        FROM inventory_bids ib
        JOIN inventory_items i ON i.id = ib.inventory_item_id
        WHERE ib.id = ${input.bidId}
      `);
      const freshRows = (fresh as unknown as {
        rows: { bid_status: string; bid_qty: number; item_qty: number }[];
      }).rows;
      if (freshRows.length === 0) throw new ForbiddenError("Forbidden");
      const f = freshRows[0];
      if (f.bid_status !== "pending") throw new ForbiddenError("Forbidden");
      quantityAccepted = f.bid_qty;

      // Slice 18b: bid asks for more than's currently available — throw
      // Forbidden. Postgres tx semantics: the throw rolls back the entire tx;
      // the bid stays pending. Owner can manually reject it on the next page
      // render. NO pre-throw UPDATE — spec §4.4 Option A.
      if (f.bid_qty > f.item_qty) {
        throw new ForbiddenError("Forbidden");
      }

      await tx
        .update(inventoryBids)
        .set({ status: "accepted", decidedAt: now })
        .where(and(
          eq(inventoryBids.id, input.bidId),
          eq(inventoryBids.status, "pending"),
        ));

      // Slice 18b: decrement item.quantity; flip status to 'sold' on zero.
      // Defense-in-depth: AND eq(orgId, sessionOrgId) — slice-3 verbatim.
      // `status: undefined` in Drizzle's set semantics means "don't touch the
      // column" — status stays whatever it was (typically 'in_stock') when
      // stock remains. The §9.3 partial-accept test asserts this.
      const newQuantity = f.item_qty - f.bid_qty;
      await tx
        .update(inventoryItems)
        .set({
          quantity: newQuantity,
          status: newQuantity === 0 ? "sold" : undefined,
          updatedAt: now,
        })
        .where(and(
          eq(inventoryItems.id, row.inventoryItemId),
          eq(inventoryItems.orgId, orgId),
        ));

      // Slice 18b: selective sibling sweep.
      //  - If stock remains (newQuantity > 0): auto-reject only siblings
      //    whose quantityRequested exceeds newQuantity. Bids that still fit
      //    stay pending (the owner may want to accept them next).
      //  - If sold-out (newQuantity === 0): unconditional auto-reject
      //    (slice-18 shape — every remaining pending bid is stale).
      if (newQuantity > 0) {
        await tx
          .update(inventoryBids)
          .set({ status: "auto_rejected", decidedAt: now })
          .where(and(
            eq(inventoryBids.inventoryItemId, row.inventoryItemId),
            eq(inventoryBids.status, "pending"),
            ne(inventoryBids.id, input.bidId),
            gt(inventoryBids.quantityRequested, newQuantity),
          ));
      } else {
        await tx
          .update(inventoryBids)
          .set({ status: "auto_rejected", decidedAt: now })
          .where(and(
            eq(inventoryBids.inventoryItemId, row.inventoryItemId),
            eq(inventoryBids.status, "pending"),
            ne(inventoryBids.id, input.bidId),
          ));
      }
      // Slice 18b: stock decrement + sold-on-zero + selective sibling sweep
      // all happen INSIDE the same locked region established by the parent-row
      // lock above. See spec §4.1 for the full transaction body and §4.4 for
      // the Postgres rollback semantics on the over-subscribed failure path.
    });
    await recordActivitySafely(
      d,
      {
        orgId,
        actor,
        entityType: "bid",
        entityId: input.bidId,
        verb: "bid_accepted",
        summary: `Accepted ${row.bidderOrgSlug}'s bid on "${row.itemName}"`,
        payload: {
          inventoryItemId: row.inventoryItemId,
          bidId: input.bidId,
          quantityAccepted,
        },
      },
      { action: "inventory.bid.accept" },
    );
  });
}

export async function rejectInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(rejectInventoryBidInput, raw, async (input, orgId, actor) => {
    const d = db();
    const [row] = await d
      .select({
        bidStatus: inventoryBids.status,
        itemOwnerOrgId: inventoryItems.orgId,
        inventoryItemId: inventoryBids.inventoryItemId,
        // Slice 24b-3: item name + bidder org slug for the bid-rejected
        // audit summary — riding this existing authz SELECT's join.
        itemName: inventoryItems.name,
        bidderOrgSlug: orgs.slug,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .innerJoin(orgs, eq(orgs.id, inventoryBids.bidderOrgId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");
    const res = await d
      .update(inventoryBids)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.status, "pending"),
      ))
      .returning();
    // The pre-check above already guarantees status === "pending" at read
    // time, so this UPDATE should always touch exactly 1 row absent a race.
    // Gate defensively anyway — mirrors the idempotent-no-op convention used
    // across circles/actions.ts (slice 24b-2) and this file's other handlers.
    if (res.length === 0) return;
    await recordActivitySafely(
      d,
      {
        orgId,
        actor,
        entityType: "bid",
        entityId: input.bidId,
        verb: "bid_rejected",
        summary: `Rejected ${row.bidderOrgSlug}'s bid on "${row.itemName}"`,
        payload: { inventoryItemId: row.inventoryItemId, bidId: input.bidId },
      },
      { action: "inventory.bid.reject" },
    );
  });
}

export async function withdrawInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(withdrawInventoryBidInput, raw, async (input, orgId, actor) => {
    const d = db();
    const [row] = await d
      .select({
        bidderOrgId: inventoryBids.bidderOrgId,
        status: inventoryBids.status,
        inventoryItemId: inventoryBids.inventoryItemId,
        // Slice 24b-3: item name for the bid-withdrawn audit summary. No
        // existing join on inventory_items in this handler — add one.
        itemName: inventoryItems.name,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.bidderOrgId !== orgId) throw new ForbiddenError("Forbidden");
    // Idempotent no-op (already withdrawn): nothing real happened — skip
    // the audit. Mirrors circles/actions.ts's `removed.length === 0` gate.
    if (row.status === "withdrawn") return;
    if (row.status !== "pending") throw new ForbiddenError("Forbidden");
    await d
      .update(inventoryBids)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.bidderOrgId, orgId),
        eq(inventoryBids.status, "pending"),
      ));
    await recordActivitySafely(
      d,
      {
        orgId,
        actor,
        entityType: "bid",
        entityId: input.bidId,
        verb: "bid_withdrawn",
        summary: `Withdrew bid on "${row.itemName}"`,
        payload: { inventoryItemId: row.inventoryItemId, bidId: input.bidId },
      },
      { action: "inventory.bid.withdraw" },
    );
  });
}

export async function setInventoryItemBidMode(raw: unknown): Promise<ActionResult> {
  return run(setInventoryItemBidModeInput, raw, async (input, orgId) => {
    // Defense-in-depth: slice-3 verbatim — UPDATE scoped to the session org.
    // If the row doesn't exist or belongs to another org, zero rows update
    // and the call returns { ok: true } silently — matches the slice-15
    // updateInventoryItem convention.
    await db()
      .update(inventoryItems)
      .set({ bidMode: input.mode, updatedAt: new Date() })
      .where(and(
        eq(inventoryItems.id, input.inventoryItemId),
        eq(inventoryItems.orgId, orgId),
      ));
  });
}
