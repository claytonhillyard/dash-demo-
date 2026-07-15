// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

describe("customer_health_snapshots migration (slice 38)", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  it("creates the customer_health_snapshots table with the expected columns", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'customer_health_snapshots'
       ORDER BY ordinal_position
    `);
    const byName = new Map(cols.rows.map((r) => [r.column_name as string, r]));
    expect(byName.get("id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("org_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("customer_id")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("score")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    expect(byName.get("band")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("components")).toMatchObject({ data_type: "jsonb", is_nullable: "NO" });
    expect(byName.get("captured_on")).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.get("captured_at")).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
  });

  it("indexes customer_health_snapshots_org_customer_day_unique and customer_health_snapshots_org_customer_idx exist", async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'customer_health_snapshots'
    `);
    const names = idx.rows.map((r) => r.indexname as string);
    expect(names).toContain("customer_health_snapshots_org_customer_day_unique");
    expect(names).toContain("customer_health_snapshots_org_customer_idx");
  });

  it("rejects inserts with a non-existent org_id (FK)", async () => {
    await expect(
      db.execute(sql`
        INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
        VALUES (99999, 1, 55, 'watch', '{"recency":1,"frequency":1,"breadth":1}', '2026-07-14')
      `),
    ).rejects.toThrow();
  });

  it("allows an insert with an unknown customer_id when org_id is valid (proves NO customer FK)", async () => {
    // org id=1 is seeded by migration 0004; ON CONFLICT guards against re-insertion.
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await expect(
      db.execute(sql`
        INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
        VALUES (1, 999999, 55, 'watch', '{"recency":1,"frequency":1,"breadth":1}', '2026-07-14')
      `),
    ).resolves.not.toThrow();
  });

  it("rejects a duplicate (org_id, customer_id, captured_on) insert (UNIQUE)", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
      VALUES (1, 2201, 55, 'watch', '{"recency":1,"frequency":1,"breadth":1}', '2026-07-14')
    `);
    await expect(
      db.execute(sql`
        INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
        VALUES (1, 2201, 61, 'watch', '{"recency":2,"frequency":2,"breadth":2}', '2026-07-14')
      `),
    ).rejects.toThrow();
  });

  it("allows the same customer on a different captured_on day (unique key is per-day)", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
      VALUES (1, 2201, 55, 'watch', '{"recency":1,"frequency":1,"breadth":1}', '2026-07-13')
    `);
    await db.execute(sql`
      INSERT INTO customer_health_snapshots (org_id, customer_id, score, band, components, captured_on)
      VALUES (1, 2201, 58, 'watch', '{"recency":2,"frequency":2,"breadth":2}', '2026-07-14')
    `);
    const rows = await db.execute(sql`
      SELECT captured_on FROM customer_health_snapshots ORDER BY captured_on
    `);
    expect(rows.rows.map((r) => r.captured_on)).toEqual(["2026-07-13", "2026-07-14"]);
  });

  it("components jsonb round-trips through drizzle's insert/select", async () => {
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (1, 'a', 'A') ON CONFLICT (id) DO NOTHING`);
    await db.insert(schema.customerHealthSnapshots).values({
      orgId: 1,
      customerId: 2201,
      score: 61,
      band: "watch",
      components: { recency: 26, frequency: 22, breadth: 13 },
      capturedOn: "2026-07-15",
    });
    const [row] = await db.select().from(schema.customerHealthSnapshots);
    expect(row.components).toEqual({ recency: 26, frequency: 22, breadth: 13 });
    expect(row.capturedAt).toBeInstanceOf(Date);
    expect(row.capturedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
