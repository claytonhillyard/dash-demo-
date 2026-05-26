// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { inventoryItems } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("inventory_items migration", () => {
  it("creates the table in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    // Selecting from the table proves the migration ran and the table exists.
    // (Use .select().from() — the pattern the Db union supports everywhere.)
    const rows = await t.db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
