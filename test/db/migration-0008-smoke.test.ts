// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration 0008 — deal reply threads", () => {
  it("creates deal_messages, deal_thread_reads, and deals.thread_mode without error", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('deal_messages', 'deal_thread_reads')
        ORDER BY tablename
      `);
      const names = (tables as unknown as { rows: { tablename: string }[] }).rows.map(
        (r) => r.tablename,
      );
      expect(names).toEqual(["deal_messages", "deal_thread_reads"]);

      const cols = await db.execute(sql`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'deals' AND column_name = 'thread_mode'
      `);
      const rows = (cols as unknown as {
        rows: { column_name: string; data_type: string; column_default: string }[];
      }).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe("text");
      expect(rows[0].column_default).toMatch(/^'private'::text$/);
    } finally {
      await close();
    }
  });
});
