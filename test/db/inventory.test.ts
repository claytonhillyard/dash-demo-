// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

async function seed(db: Db) {
  await db.insert(inventoryItems).values([
    { category: "Rings", name: "A", quantity: 3, status: "in_stock" },
    { category: "Rings", name: "B", quantity: 2, status: "reserved" },
    { category: "Rings", name: "C", quantity: 5, status: "sold" },      // excluded
    { category: "Diamonds", name: "D", quantity: 10, status: "in_stock" },
    { category: "Necklaces", name: "E", quantity: 1, status: "in_stock", orgId: 2 }, // other org
  ]);
}

describe("getInventorySummary", () => {
  it("sums on-hand quantity per category, excludes sold, scopes to the org, zero-fills", async () => {
    const t = await createTestDb();
    close = t.close;
    await seed(t.db);
    const s = await getInventorySummary(t.db); // defaults to AIYA org (1)
    expect(s.counts.Rings).toBe(5);        // 3 + 2, sold excluded
    expect(s.counts.Diamonds).toBe(10);
    expect(s.counts.Necklaces).toBe(0);    // the qty-1 row is org 2
    expect(s.counts.Earrings).toBe(0);     // zero-filled
    expect(s.total).toBe(15);
    expect(s.updatedAt).not.toBeNull();
  });

  it("returns all-zero counts and null updatedAt for an empty org", async () => {
    const t = await createTestDb();
    close = t.close;
    const s = await getInventorySummary(t.db);
    expect(s.total).toBe(0);
    expect(s.counts.Rings).toBe(0);
    expect(s.updatedAt).toBeNull();
  });
});
