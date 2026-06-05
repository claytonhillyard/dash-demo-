// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration 0009 — bidding (slice 16)", () => {
  it("creates the bids table and deals.bid_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'bids'
      `);
      const tableRows = (tables as unknown as { rows: { tablename: string }[] }).rows;
      expect(tableRows.map((r) => r.tablename)).toEqual(["bids"]);

      const cols = await db.execute(sql`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'deals' AND column_name = 'bid_mode'
      `);
      const colRows = (cols as unknown as {
        rows: { column_name: string; data_type: string; column_default: string }[];
      }).rows;
      expect(colRows).toHaveLength(1);
      expect(colRows[0].data_type).toBe("text");
      expect(colRows[0].column_default).toMatch(/^'single'::text$/);

      const bidCols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'bids'
        ORDER BY ordinal_position
      `);
      const bidColRows = (bidCols as unknown as {
        rows: { column_name: string; is_nullable: "YES" | "NO" }[];
      }).rows;
      const bidColMap = new Map(bidColRows.map((r) => [r.column_name, r.is_nullable]));
      expect(bidColMap.get("id")).toBe("NO");
      expect(bidColMap.get("deal_id")).toBe("NO");
      expect(bidColMap.get("bidder_org_id")).toBe("NO");
      expect(bidColMap.get("price_cents")).toBe("NO");
      expect(bidColMap.get("notes")).toBe("YES");
      expect(bidColMap.get("decided_at")).toBe("YES");
    } finally {
      await close();
    }
  });
});
