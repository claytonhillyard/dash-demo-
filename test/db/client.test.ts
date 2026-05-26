// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb, ensureDbReady } from "@/db/client";
import { revenueMonths, inventoryItems } from "@/db/schema";

describe("db client", () => {
  it("createTestDb gives an isolated, migrated pglite db", async () => {
    const a = await createTestDb();
    const b = await createTestDb();

    await a.db.insert(revenueMonths).values({ year: 2026, month: 1, amountCents: 100_00 });

    const aRows = await a.db.select().from(revenueMonths);
    const bRows = await b.db.select().from(revenueMonths);

    expect(aRows).toHaveLength(1);
    expect(aRows[0].amountCents).toBe(100_00);
    expect(bRows).toHaveLength(0); // isolation: b never saw a's write

    await a.close();
    await b.close();
  });

  it("ensureDbReady returns a fully-migrated db (no first-query race)", async () => {
    // Awaiting readiness must guarantee the schema exists — querying a table
    // immediately afterward must not throw "relation does not exist".
    const db = await ensureDbReady();
    const rows = await db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(Array.isArray(rows)).toBe(true);
  });
});
