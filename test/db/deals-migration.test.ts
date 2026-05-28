// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/client";
import { deals } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("deals migration", () => {
  it("creates the deals table in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select({ id: deals.id }).from(deals);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
