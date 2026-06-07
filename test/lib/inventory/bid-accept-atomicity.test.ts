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
  it("accepts one bid, auto-rejects siblings, leaves inventory_items.status unchanged", async () => {
    // Seed item owned by org 1, bidding enabled
    const [item] = await db
      .insert(inventoryItems)
      .values({
        orgId: 1, category: "Diamonds", name: "x", quantity: 10,
        status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
        bidMode: "single",
      })
      .returning();
    // Three pending bids
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
    expect(byId.get(insertedBids[0].id)?.status).toBe("auto_rejected");
    expect(byId.get(insertedBids[1].id)?.status).toBe("accepted");
    expect(byId.get(insertedBids[2].id)?.status).toBe("auto_rejected");
    expect(byId.get(insertedBids[0].id)?.decidedAt).not.toBeNull();
    expect(byId.get(insertedBids[1].id)?.decidedAt).not.toBeNull();
    expect(byId.get(insertedBids[2].id)?.decidedAt).not.toBeNull();

    // inventory_items.status UNCHANGED — slice 18 doesn't touch stock
    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(10);
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
      { inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 100 },
      { inventoryItemId: item.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 200 },
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

    // DB state: one accepted, one auto_rejected — never both accepted
    const after = await db.select().from(inventoryBids).where(eq(inventoryBids.inventoryItemId, item.id));
    const accepted = after.filter((b) => b.status === "accepted");
    const autoRejected = after.filter((b) => b.status === "auto_rejected");
    expect(accepted).toHaveLength(1);
    expect(autoRejected).toHaveLength(1);

    // Inventory item still untouched
    const [itemAfter] = await db
      .select({ status: inventoryItems.status, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(itemAfter.status).toBe("in_stock");
    expect(itemAfter.quantity).toBe(5);
  });
});
