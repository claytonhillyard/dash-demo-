// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { diamondMatrixPrices } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("diamond migration", () => {
  it("creates the diamond tables in a fresh pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select({ id: diamondMatrixPrices.id }).from(diamondMatrixPrices);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
