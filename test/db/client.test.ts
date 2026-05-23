// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { revenueMonths } from "@/db/schema";

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
});
