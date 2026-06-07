// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration 0013 — inventory bidding (slice 18)", () => {
  it("creates inventory_bids and inventory_items.bid_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      // Table exists
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'inventory_bids'
      `);
      const tableRows = (tables as unknown as { rows: { tablename: string }[] }).rows;
      expect(tableRows.map((r) => r.tablename)).toEqual(["inventory_bids"]);

      // inventory_items.bid_mode is nullable text with no default
      const cols = await db.execute(sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'inventory_items' AND column_name = 'bid_mode'
      `);
      const colRows = (cols as unknown as {
        rows: { column_name: string; data_type: string; is_nullable: "YES" | "NO"; column_default: string | null }[];
      }).rows;
      expect(colRows).toHaveLength(1);
      expect(colRows[0].data_type).toBe("text");
      expect(colRows[0].is_nullable).toBe("YES");
      expect(colRows[0].column_default).toBeNull();

      // inventory_bids column shape
      const bidCols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'inventory_bids'
        ORDER BY ordinal_position
      `);
      const bidColRows = (bidCols as unknown as {
        rows: { column_name: string; is_nullable: "YES" | "NO" }[];
      }).rows;
      const bidColMap = new Map(bidColRows.map((r) => [r.column_name, r.is_nullable]));
      expect(bidColMap.get("id")).toBe("NO");
      expect(bidColMap.get("inventory_item_id")).toBe("NO");
      expect(bidColMap.get("bidder_org_id")).toBe("NO");
      expect(bidColMap.get("price_cents")).toBe("NO");
      expect(bidColMap.get("notes")).toBe("YES");
      expect(bidColMap.get("decided_at")).toBe("YES");
    } finally {
      await close();
    }
  });
});
