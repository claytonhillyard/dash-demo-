// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("activity_events migration (slice 24)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  it("creates the activity_events table with the expected columns", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'activity_events'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("actor")).toMatchObject({ data_type: "text", is_nullable: "YES" });
    expect(byName.get("entity_type")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("entity_id")).toMatchObject({ data_type: "integer", is_nullable: "YES" });
    expect(byName.get("verb")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("summary")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("payload")).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
  });

  it("indexes activity_events_org_created_idx and activity_events_org_entity_idx exist", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'activity_events'
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("activity_events_org_created_idx");
    expect(names).toContain("activity_events_org_entity_idx");
  });

  it("rejects inserts with a non-existent org_id (FK)", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO activity_events (org_id, entity_type, verb, summary)
        VALUES (99999, 'customer', 'created', 'orphan org')
      `),
    ).rejects.toThrow();
  });

  it("allows entity_id to be NULL (orphan entity rows are intentional)", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO activity_events (org_id, entity_type, verb, summary)
      VALUES (1, 'org', 'created', 'org bootstrap')
    `);
    const rows = await db.execute(sql`SELECT entity_id FROM activity_events`);
    expect(rows.rows[0]?.entity_id).toBeNull();
  });

  it("created_at defaults to now() and round-trips as a Date", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.insert(schema.activityEvents).values({
      orgId: 1, entityType: "customer", verb: "created", summary: "x",
    });
    const [row] = await db.select().from(schema.activityEvents);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
