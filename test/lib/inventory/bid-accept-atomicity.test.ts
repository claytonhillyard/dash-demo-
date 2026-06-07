// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids, orgs } from "@/db/schema";
import { acceptInventoryBid, __setTestDb } from "@/lib/inventory/actions";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

describe("acceptInventoryBid — atomicity", () => {
  it("accepts one bid, decrements stock by 1, leaves smaller-fitting bids pending", async () => {
    // Seed item owned by org 1, bidding enabled
    const [item] = await db
      .insert(inventoryItems)
      .values({
        orgId: 1, category: "Diamonds", name: "x", quantity: 10,
        status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
        bidMode: "single",
      })
      .returning();
    // Three pending bids (qty_requested defaults to 1 each)
    await db.insert(orgs).values([
      { id: 777, name: "Bidder777", slug: "bidder-777" },
    ]).onConflictDoNothing();
    const insertedBids = await db.insert(inventoryBids).values([
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "Bidder999", priceCents: 100 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "Bidder888", priceCents: 200 },
      { inventoryItemId: item.id, bidderOrgId: 777, bidderOrgLabel: "Bidder777", priceCents: 300 },
    ]).returning();

    // Accept the second bid as owner
    const res = await acceptInventoryBid({ bidId: insertedBids[1].id });
    expect(res).toEqual({ ok: true });

    const after = await db.select().from(inventoryBids).orderBy(inventoryBids.id);
    const byId = new Map(after.map((b) => [b.id, b]));
    // Slice 18b: 1-unit accept on 10-unit stock leaves 9 units — siblings
    // (also 1-unit each) still fit, so they stay pending.
    expect(byId.get(insertedBids[0].id)?.status).toBe("pending");
    expect(byId.get(insertedBids[1].id)?.status).toBe("accepted");
    expect(byId.get(insertedBids[2].id)?.status).toBe("pending");
    // decidedAt: only the accepted bid has it set
    expect(byId.get(insertedBids[0].id)?.decidedAt).toBeNull();
    expect(byId.get(insertedBids[1].id)?.decidedAt).not.toBeNull();
    expect(byId.get(insertedBids[2].id)?.decidedAt).toBeNull();

    // Slice 18b: item.quantity decrements by 1; status unchanged (stock remains)
    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(9);
  });

  it("non-owner cannot accept", async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock", unitCostCents: 100, retailPriceCents: 200, bidMode: "single" })
      .returning();
    const [bid] = await db.insert(inventoryBids).values({
      inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1,
    }).returning();

    const { requireSession } = await import("@/lib/auth/requireSession");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

    const res = await acceptInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [after] = await db.select({ status: inventoryBids.status }).from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("pending");
  });

  it("cannot accept a non-pending bid", async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({ orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock", unitCostCents: 100, retailPriceCents: 200, bidMode: "single" })
      .returning();
    const [bid] = await db.insert(inventoryBids).values({
      inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1, status: "withdrawn", decidedAt: new Date(),
    }).returning();

    const res = await acceptInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  // Spec §9.3: two acceptInventoryBid calls racing on different bids of the
  // same item — exactly one wins; the other returns Forbidden. The protection
  // is the `AND status='pending'` guard in BOTH UPDATE statements inside the
  // transaction. The losing tx sees the sibling row already auto_rejected (or
  // its own row already accepted by the winner) and the UPDATE matches 0 rows,
  // re-asserting pending and re-emitting Forbidden via the post-tx re-read.
  //
  // Slice 18b note: both bids are seeded with quantityRequested=5 (matching
  // the item's full stock) so they truly compete. Under slice-18 semantics
  // the field is ignored — the race still holds. Once Phase B's selective-
  // sweep lands, this seeding ensures both bids remain mutually exclusive
  // (neither fits in the residual after the other accepts) so "exactly one
  // wins" continues to be the correct assertion.
  it("two concurrent accepts on the same item — exactly one wins", async () => {
    const [item] = await db
      .insert(inventoryItems)
      .values({
        orgId: 1, category: "Diamonds", name: "race-item", quantity: 5,
        status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
        bidMode: "single",
      })
      .returning();
    const [bidA, bidB] = await db.insert(inventoryBids).values([
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 5 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 5 },
    ]).returning();

    const [resA, resB] = await Promise.all([
      acceptInventoryBid({ bidId: bidA.id }),
      acceptInventoryBid({ bidId: bidB.id }),
    ]);

    // Exactly one ok + one Forbidden, in either order
    const oks = [resA, resB].filter((r) => r.ok === true);
    const fails = [resA, resB].filter((r) => r.ok === false);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toEqual({ ok: false, error: "Forbidden" });

    // DB state: one accepted, one auto_rejected. The winning tx drained the
    // 5-unit item to qty=0 and took the sold-out branch — its unconditional
    // sibling sweep auto_rejected the other 5-unit bid before the loser's tx
    // even reached its re-read. The loser then sees bid_status='auto_rejected'
    // (or, equivalently in the over-subscribed branch, sees item.qty=0 < 5)
    // and bails with Forbidden. Either way: never two accepts.
    const after = await db.select().from(inventoryBids).where(eq(inventoryBids.inventoryItemId, item.id));
    const accepted = after.filter((b) => b.status === "accepted");
    const autoRejected = after.filter((b) => b.status === "auto_rejected");
    expect(accepted).toHaveLength(1);
    expect(autoRejected).toHaveLength(1);

    // Slice 18b: the accepted 5-unit bid drains the 5-unit item — quantity 0,
    // status flips to 'sold'.
    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("sold");
    expect(itemAfter.quantity).toBe(0);
  });

  it("partial accept leaves smaller bids pending, rejects oversubscribed bids", async () => {
    // Item with quantity 10, bidding enabled
    const [item] = await db.insert(inventoryItems).values({
      orgId: 1, category: "Diamonds", name: "parcel", quantity: 10,
      status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
      bidMode: "history",
    }).returning();

    await db.insert(orgs).values([
      { id: 777, name: "Bidder777", slug: "bidder-777" },
    ]).onConflictDoNothing();

    // Three pending bids: A wants 3, B wants 7, C wants 11. The C=11 bid
    // would never have passed canBidOnItem's 6th precondition (11 > 10) — we
    // seed it directly to test the accept-side selective-sweep guard.
    const [bidA, bidB, bidC] = await db.insert(inventoryBids).values([
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 3 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 7 },
      { inventoryItemId: item.id, bidderOrgId: 777, bidderOrgLabel: "C", priceCents: 300, quantityRequested: 11 },
    ]).returning();

    // Accept B (7 units)
    const res = await acceptInventoryBid({ bidId: bidB.id });
    expect(res).toEqual({ ok: true });

    const after = await db.select().from(inventoryBids).orderBy(inventoryBids.id);
    const byId = new Map(after.map((b) => [b.id, b]));
    expect(byId.get(bidA.id)?.status).toBe("pending");          // 3 ≤ 3 remaining → stays pending
    expect(byId.get(bidB.id)?.status).toBe("accepted");
    expect(byId.get(bidC.id)?.status).toBe("auto_rejected");    // 11 > 3 remaining → auto_rejected

    expect(byId.get(bidA.id)?.decidedAt).toBeNull();
    expect(byId.get(bidB.id)?.decidedAt).not.toBeNull();
    expect(byId.get(bidC.id)?.decidedAt).not.toBeNull();

    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(3);     // 10 - 7 = 3
  });

  it("sold-on-zero flips inventory_items.status to 'sold'", async () => {
    const [item] = await db.insert(inventoryItems).values({
      orgId: 1, category: "Diamonds", name: "single-stone", quantity: 5,
      status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
      bidMode: "single",
    }).returning();

    const [bidA, bidB] = await db.insert(inventoryBids).values([
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100, quantityRequested: 2 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200, quantityRequested: 5 },
    ]).returning();

    const res = await acceptInventoryBid({ bidId: bidB.id });
    expect(res).toEqual({ ok: true });

    const [itemAfter] = await db.select({
      status: inventoryItems.status,
      quantity: inventoryItems.quantity,
    }).from(inventoryItems).where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("sold");
    expect(itemAfter.quantity).toBe(0);

    // Sold-out branch: all siblings auto_rejected unconditionally, regardless
    // of size (matches slice-18 unconditional-sweep shape).
    const [bidAAfter] = await db.select({ status: inventoryBids.status })
      .from(inventoryBids).where(eq(inventoryBids.id, bidA.id));
    expect(bidAAfter.status).toBe("auto_rejected");
  });

  it("over-subscribed accept returns Forbidden and leaves bid pending", async () => {
    // Item has 3 units; bid asks for 5 (was posted when stock was higher).
    const [item] = await db.insert(inventoryItems).values({
      orgId: 1, category: "Diamonds", name: "shrunk", quantity: 3,
      status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
      bidMode: "history",
    }).returning();
    const [bid] = await db.insert(inventoryBids).values({
      inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "X",
      priceCents: 100, quantityRequested: 5,
    }).returning();

    const res = await acceptInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });

    // Post-state: tx rolled back; bid still pending (NOT auto_rejected)
    const [bidAfter] = await db.select({ status: inventoryBids.status, decidedAt: inventoryBids.decidedAt })
      .from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(bidAfter.status).toBe("pending");
    expect(bidAfter.decidedAt).toBeNull();

    // Item untouched
    const [itemAfter] = await db.select({
      status: inventoryItems.status,
      quantity: inventoryItems.quantity,
    }).from(inventoryItems).where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(3);
  });
});
