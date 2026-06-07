"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { inventoryItems, inventoryBids } from "@/db/schema";
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

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors the company actions pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw to the UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>
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
  return run(inventoryItemInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db().insert(inventoryItems).values(insertValues(input, orgId));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    await ensureCanShare(orgId, input.visibilityCircleId);
    await db()
      .update(inventoryItems)
      .set({ ...updateValues(input, orgId), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)));
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, rid), eq(inventoryItems.orgId, orgId)));
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
    }
  | { ok: false }
> {
  const [row] = await d
    .select({
      ownerOrgId: inventoryItems.orgId,
      bidMode: inventoryItems.bidMode,
      visibilityCircleId: inventoryItems.visibilityCircleId,
      quantity: inventoryItems.quantity,
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
    bidMode: row.bidMode,
    visibilityCircleId: row.visibilityCircleId,
  };
}

export async function postInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(postInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const access = await canBidOnItem(d, orgId, input.inventoryItemId, input.quantityRequested);
    if (!access.ok) throw new ForbiddenError("Forbidden");
    const label = await resolveOrgLabel(d, orgId);
    await d.insert(inventoryBids).values({
      inventoryItemId: input.inventoryItemId,
      bidderOrgId: orgId,
      bidderOrgLabel: label,
      priceCents: input.priceCents,
      currency: input.currency,
      notes: input.notes ?? null,
      quantityRequested: input.quantityRequested,
    });
  });
}

export async function acceptInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(acceptInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidId: inventoryBids.id,
        bidStatus: inventoryBids.status,
        inventoryItemId: inventoryBids.inventoryItemId,
        itemOwnerOrgId: inventoryItems.orgId,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");

    const now = new Date();
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

      // Re-read bid status inside the locked tx — the previously-snapshotted
      // pre-tx SELECT may have observed pending even if a sibling tx has
      // since flipped this bid to auto_rejected.
      const fresh = await tx.execute(
        sql`SELECT status FROM inventory_bids WHERE id = ${input.bidId}`,
      );
      const freshRows = (fresh as unknown as { rows: { status: string }[] }).rows;
      if (freshRows.length === 0 || freshRows[0].status !== "pending") {
        throw new ForbiddenError("Forbidden");
      }

      await tx
        .update(inventoryBids)
        .set({ status: "accepted", decidedAt: now })
        .where(and(
          eq(inventoryBids.id, input.bidId),
          eq(inventoryBids.status, "pending"),
        ));
      await tx
        .update(inventoryBids)
        .set({ status: "auto_rejected", decidedAt: now })
        .where(and(
          eq(inventoryBids.inventoryItemId, row.inventoryItemId),
          eq(inventoryBids.status, "pending"),
          ne(inventoryBids.id, input.bidId),
        ));
      // NOTE: we do NOT touch inventory_items.status. Bidding is a price
      // negotiation; stock-deduction is a separate concern (slice 18b).
      // See spec §5.3.
    });
  });
}

export async function rejectInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(rejectInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidStatus: inventoryBids.status,
        itemOwnerOrgId: inventoryItems.orgId,
      })
      .from(inventoryBids)
      .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryBids.inventoryItemId))
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.itemOwnerOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.bidStatus !== "pending") throw new ForbiddenError("Forbidden");
    await d
      .update(inventoryBids)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.status, "pending"),
      ));
  });
}

export async function withdrawInventoryBid(raw: unknown): Promise<ActionResult> {
  return run(withdrawInventoryBidInput, raw, async (input, orgId) => {
    const d = db();
    const [row] = await d
      .select({
        bidderOrgId: inventoryBids.bidderOrgId,
        status: inventoryBids.status,
      })
      .from(inventoryBids)
      .where(eq(inventoryBids.id, input.bidId))
      .limit(1);
    if (!row) throw new ForbiddenError("Forbidden");
    if (row.bidderOrgId !== orgId) throw new ForbiddenError("Forbidden");
    if (row.status === "withdrawn") return; // idempotent
    if (row.status !== "pending") throw new ForbiddenError("Forbidden");
    await d
      .update(inventoryBids)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(
        eq(inventoryBids.id, input.bidId),
        eq(inventoryBids.bidderOrgId, orgId),
        eq(inventoryBids.status, "pending"),
      ));
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
