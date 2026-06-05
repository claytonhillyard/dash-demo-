// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, bids } from "@/db/schema";
import { getBidsForDeal } from "@/db/bids";

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

async function seedDeal(orgId: number) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "bid-test",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "owner",
    })
    .returning();
  return row.id;
}

describe("getBidsForDeal — visibility filter", () => {
  it("returns the bid to its bidder", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 999, dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(1200);
    expect(rows[0].status).toBe("pending");
  });

  it("returns the bid to the deal owner", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 1, dealId);
    expect(rows).toHaveLength(1);
  });

  it("hides the bid from a third party", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values({
      dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta",
      priceCents: 1200, bidMode: "single",
    });
    const rows = await getBidsForDeal(db, 888, dealId);
    expect(rows).toEqual([]);
  });

  it("orders bids newest-first", async () => {
    const dealId = await seedDeal(1);
    await db.insert(bids).values([
      { dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1100, bidMode: "single",
        createdAt: new Date(Date.now() - 60_000) },
      { dealId, bidderOrgId: 999, bidderOrgLabel: "Mehta", priceCents: 1200, bidMode: "single",
        createdAt: new Date() },
    ]);
    const rows = await getBidsForDeal(db, 1, dealId);
    expect(rows.map((r) => r.priceCents)).toEqual([1200, 1100]);
  });
});
