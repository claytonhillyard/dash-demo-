// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { sql } from "drizzle-orm";

describe("migration 0012 — deal_attachments (slice 17)", () => {
  it("creates the table with expected columns and UNIQUE on storage_key", async () => {
    const { db, close } = await createTestDb();
    try {
      const tables = await db.execute(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'deal_attachments'
      `);
      expect(
        (tables as unknown as { rows: { tablename: string }[] }).rows.map((r) => r.tablename),
      ).toEqual(["deal_attachments"]);

      const cols = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'deal_attachments'
        ORDER BY ordinal_position
      `);
      const colMap = new Map(
        (cols as unknown as { rows: { column_name: string; is_nullable: "YES" | "NO" }[] }).rows.map(
          (r) => [r.column_name, r.is_nullable],
        ),
      );
      expect(colMap.get("id")).toBe("NO");
      expect(colMap.get("deal_id")).toBe("NO");
      expect(colMap.get("uploaded_by_org_id")).toBe("NO");
      expect(colMap.get("storage_key")).toBe("NO");
      expect(colMap.get("mime_type")).toBe("NO");
      expect(colMap.get("alt_text")).toBe("YES");
      expect(colMap.get("size_bytes")).toBe("NO");
      expect(colMap.get("kind")).toBe("NO");

      // The slice-3 migration pre-seeds AIYA at orgs.id=1; idempotently re-assert it.
      await db.execute(sql`
        INSERT INTO orgs (id, name, slug) VALUES (1, 'AIYA', 'aiya')
        ON CONFLICT (id) DO NOTHING
      `);
      const orgId = 1;
      const dealRes = await db.execute(sql`
        INSERT INTO deals (org_id, kind, category, subject, quantity, price_cents, posted_by_label)
        VALUES (${orgId}, 'SELL', 'Diamond', 'x', 1, 1, 'x') RETURNING id
      `);
      const dealId = (dealRes as unknown as { rows: { id: number }[] }).rows[0].id;

      // UNIQUE INDEX on storage_key smoke: insert twice → 2nd throws
      const insertOnce = sql`
        INSERT INTO deal_attachments (deal_id, uploaded_by_org_id, kind, storage_key, mime_type, size_bytes)
        VALUES (${dealId}, ${orgId}, 'image', 'org/1/deal/${sql.raw(String(dealId))}/image/abc.jpg', 'image/jpeg', 1024)
      `;
      await db.execute(insertOnce);
      await expect(db.execute(insertOnce)).rejects.toThrow();
    } finally {
      await close();
    }
  });
});
