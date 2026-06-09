// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import {
  getSharedDb,
  closeSharedDb,
} from "../helpers/shared-db";
import type { Db } from "@/db/client";

/**
 * Slice 22 schema smoke test. Proves the migrations applied cleanly and the
 * shapes the design depends on are actually present:
 *   1. `customers` table exists with the expected columns
 *   2. The partial-unique index `(org_id, external_ref) WHERE external_ref
 *      IS NOT NULL` REJECTS duplicate non-null external_ref within the same org
 *   3. The same partial-unique ALLOWS multiple NULL external_ref rows in the
 *      same org (so direct-create customers from slice 22 never collide on
 *      that index, regardless of how many sit in the same org)
 *
 * Why this matters: the partial-where is the entire reason `external_ref` is
 * on the table — slice 26 (WinJewel CSV import) uses
 * (org_id, external_ref) as its UPSERT idempotency key. If the partial
 * where ever silently dropped during a migration round-trip, slice 26 would
 * either reject legitimate direct-create rows OR allow duplicate imports
 * without surfacing the conflict.
 */
describe("customers — migration smoke", () => {
  let db: Db;

  beforeAll(async () => {
    db = await getSharedDb();
  });

  afterAll(async () => {
    await closeSharedDb();
  });

  it("created the customers table with required columns", async () => {
    const res = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customers'
      ORDER BY ordinal_position
    `);
    const rows = (res as unknown as { rows: Array<{ column_name: string }> })
      .rows;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        "id",
        "org_id",
        "name",
        "business_name",
        "email",
        "phone",
        "address",
        "notes",
        "external_ref",
        "first_seen_at",
        "created_at",
        "updated_at",
      ].sort(),
    );
  });

  it("partial-unique on (org_id, external_ref) rejects same-org duplicate non-null external_ref", async () => {
    // Seed an org. Test relies on default seed: org id=1 exists already.
    // Insert raw via execute() so we don't depend on the typed schema import
    // (which would also exercise the path we're trying to certify).
    await db.execute(sql`
      INSERT INTO customers (org_id, name, external_ref)
      VALUES (1, 'A', 'WJ-DUPE-001')
    `);

    let caught: unknown = null;
    try {
      await db.execute(sql`
        INSERT INTO customers (org_id, name, external_ref)
        VALUES (1, 'B', 'WJ-DUPE-001')
      `);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    // pglite wraps the underlying PG error such that neither `.code` (23505)
    // nor a human-readable "duplicate"/"unique" substring is reliably exposed
    // to the application. The contract we actually care about is "the second
    // insert did NOT commit" — assert by row count, which works identically
    // against pglite (dev/test) and node-postgres (prod) without coupling to
    // driver-specific error shapes.
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM customers
      WHERE org_id = 1 AND external_ref = 'WJ-DUPE-001'
    `);
    const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
    expect(rows[0]?.n ?? 0).toBe(1);
  });

  it("partial-unique allows multiple NULL external_ref rows in the same org", async () => {
    // Inserts both succeed because the partial where clause excludes NULLs
    // from the uniqueness check.
    await db.execute(sql`
      INSERT INTO customers (org_id, name) VALUES (1, 'C')
    `);
    await db.execute(sql`
      INSERT INTO customers (org_id, name) VALUES (1, 'D')
    `);

    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM customers
      WHERE org_id = 1 AND external_ref IS NULL
    `);
    const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(2);
  });
});
