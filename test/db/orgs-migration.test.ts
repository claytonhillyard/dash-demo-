// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { orgs } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("orgs migration", () => {
  it("creates the orgs table and seeds AIYA at id=1 in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select().from(orgs);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe("AIYA Designs");
    expect(rows[0].slug).toBe("aiya");
  });

  it("enforces the slug unique constraint", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (2, 'Dup', 'aiya')`)
    ).rejects.toThrow();
  });

  it("rejects tenanted inserts whose org_id has no matching orgs row", async () => {
    const t = await createTestDb();
    close = t.close;
    // org_id=2 doesn't exist yet — FK must reject.
    await expect(
      t.db.execute(
        sql`INSERT INTO inventory_items (org_id, category, name) VALUES (2, 'Rings', 'X')`
      )
    ).rejects.toThrow();
  });
});
