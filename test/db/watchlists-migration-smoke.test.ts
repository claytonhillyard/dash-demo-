// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("watchlists migration (slice 25)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  it("creates the watchlists table with the expected columns", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'watchlists'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("actor")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("entity_type")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("entity_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("notify_email")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("last_notified_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "YES",
    });
    expect(byName.get("created_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("indexes watchlists_org_actor_entity_unique and watchlists_org_entity_idx exist", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'watchlists'
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("watchlists_org_actor_entity_unique");
    expect(names).toContain("watchlists_org_entity_idx");
  });

  it("rejects inserts with a non-existent org_id (FK)", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO watchlists (org_id, actor, entity_type, entity_id, notify_email)
        VALUES (99999, 'alice', 'customer', 1, 'alice@example.com')
      `),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (org_id, actor, entity_type, entity_id) insert (UNIQUE)", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO watchlists (org_id, actor, entity_type, entity_id, notify_email)
      VALUES (1, 'alice', 'customer', 1, 'alice@example.com')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO watchlists (org_id, actor, entity_type, entity_id, notify_email)
        VALUES (1, 'alice', 'customer', 1, 'alice-other@example.com')
      `),
    ).rejects.toThrow();
  });

  it("allows a different actor to watch the same entity (unique key is per-actor)", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO watchlists (org_id, actor, entity_type, entity_id, notify_email)
      VALUES (1, 'alice', 'customer', 1, 'alice@example.com')
    `);
    await db.execute(sql`
      INSERT INTO watchlists (org_id, actor, entity_type, entity_id, notify_email)
      VALUES (1, 'bob', 'customer', 1, 'bob@example.com')
    `);
    const rows = await db.execute(sql`SELECT actor FROM watchlists ORDER BY actor`);
    expect(rows.rows.map((r) => r.actor)).toEqual(["alice", "bob"]);
  });

  it("created_at defaults to now() and round-trips as a Date", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.insert(schema.watchlists).values({
      orgId: 1, actor: "alice", entityType: "customer", entityId: 1, notifyEmail: "alice@example.com",
    });
    const [row] = await db.select().from(schema.watchlists);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
