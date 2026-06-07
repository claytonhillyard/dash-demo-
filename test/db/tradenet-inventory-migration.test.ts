// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getSharedDb, closeSharedDb } from "../helpers/shared-db";

describe("slice 15 migration", () => {
  beforeAll(async () => { await getSharedDb(); });
  afterAll(async () => { await closeSharedDb(); });

  it("inventory_items has visibility_circle_id column", async () => {
    const db = await getSharedDb();
    const rows = await db.execute(
      sql`SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'inventory_items' AND column_name = 'visibility_circle_id'`,
    );
    expect(rows.rows.length).toBe(1);
    // Postgres returns 'YES' / 'NO' as strings for is_nullable.
    expect((rows.rows[0] as Record<string, unknown>).is_nullable).toBe("YES");
  });

  it("inventory_items_visibility_circle_idx exists and is partial", async () => {
    const db = await getSharedDb();
    const rows = await db.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename = 'inventory_items'
            AND indexname = 'inventory_items_visibility_circle_idx'`,
    );
    expect(rows.rows.length).toBe(1);
    const def = (rows.rows[0] as Record<string, unknown>).indexdef as string;
    expect(def.toLowerCase()).toContain("where (visibility_circle_id is not null)");
  });
});
