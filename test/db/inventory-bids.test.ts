// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { inventoryItems, inventoryBids, circles, circleMembers, orgs } from "@/db/schema";
import { getInventoryBidsForItem } from "@/db/inventoryBids";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedItem(ownerOrgId: number, opts: {
  visibilityCircleId?: number | null;
  bidMode?: "single" | "history" | null;
} = {}) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      orgId: ownerOrgId,
      category: "Diamonds",
      name: "test-item",
      quantity: 1,
      status: "in_stock",
      unitCostCents: 100_000,
      retailPriceCents: 200_000,
      visibilityCircleId: opts.visibilityCircleId ?? null,
      bidMode: opts.bidMode ?? null,
    })
    .returning();
  return row.id;
}

async function ensureOrg(orgId: number, name: string) {
  await db.insert(orgs).values({ id: orgId, name, slug: `${name}-${orgId}` }).onConflictDoNothing();
}

async function ensureCircleWithMembers(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("getInventoryBidsForItem — visibility truth table", () => {
  it("returns the bid to its bidder", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 999, itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
  });

  it("returns the bid to the item owner", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows).toHaveLength(1);
  });

  it("hides the bid from a third party in the same circle", async () => {
    await ensureOrg(888, "third");
    const circleId = await ensureCircleWithMembers("c1", "c1", 1, [1, 999, 888]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 12_300_00,
    });
    const rows = await getInventoryBidsForItem(db, 888, itemId);
    expect(rows).toEqual([]);
  });

  it("hides the bid from a stranger", async () => {
    await ensureOrg(888, "stranger");
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1,
    });
    const rows = await getInventoryBidsForItem(db, 888, itemId);
    expect(rows).toEqual([]);
  });

  it("orders bids newest-first", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values([
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1100, createdAt: new Date(Date.now() - 60_000) },
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1200, createdAt: new Date() },
    ]);
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows.map((r) => r.priceCents)).toEqual([1200, 1100]);
  });

  it("returns [] in demo mode regardless of viewer", async () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const itemId = await seedItem(1);
      await db.insert(inventoryBids).values({
        inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
        priceCents: 1,
      });
      expect(await getInventoryBidsForItem(db, 1, itemId)).toEqual([]);
      expect(await getInventoryBidsForItem(db, 999, itemId)).toEqual([]);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_MODE = prev;
    }
  });

  it("projects quantityRequested for each visible bid", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 100, quantityRequested: 7,
    });
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantityRequested).toBe(7);
  });

  it("defaults quantityRequested to 1 when omitted on insert", async () => {
    const itemId = await seedItem(1);
    await db.insert(inventoryBids).values({
      inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 100,
      // quantityRequested omitted — DB DEFAULT 1 should apply
    });
    const rows = await getInventoryBidsForItem(db, 1, itemId);
    expect(rows[0].quantityRequested).toBe(1);
  });
});
