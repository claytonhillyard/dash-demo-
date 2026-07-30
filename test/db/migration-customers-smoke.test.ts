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
        "style_note", // slice 37 — per-customer drafting voice note
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

/**
 * Slice 37 migration 0023 smoke test. Proves the additive migration applied
 * cleanly: the new `drafting_prefs` table exists with its unique org index
 * enforced, and `customers` gained a nullable `style_note` column. Same
 * "raw execute() against information_schema / a real constraint violation"
 * approach as the slice-22 tests above — never through the typed schema
 * import, so this doesn't also exercise the path it's certifying.
 */
describe("drafting_prefs + customers.style_note — migration smoke (slice 37)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await getSharedDb();
  });

  afterAll(async () => {
    await closeSharedDb();
  });

  it("created the drafting_prefs table with required columns", async () => {
    const res = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'drafting_prefs'
      ORDER BY ordinal_position
    `);
    const rows = (res as unknown as { rows: Array<{ column_name: string }> })
      .rows;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(["id", "org_id", "tone", "signature", "updated_at"].sort());
  });

  it("unique index on org_id rejects a second drafting_prefs row for the same org", async () => {
    // Test relies on the shared-db default seed: org id=1 exists already.
    await db.execute(sql`
      INSERT INTO drafting_prefs (org_id, tone) VALUES (1, 'first')
    `);

    let caught: unknown = null;
    try {
      await db.execute(sql`
        INSERT INTO drafting_prefs (org_id, tone) VALUES (1, 'second')
      `);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    // Same "assert by row count" discipline as the customers partial-unique
    // test above — robust to pglite vs. node-postgres error-shape differences.
    const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM drafting_prefs WHERE org_id = 1
    `);
    const rows = (res as unknown as { rows: Array<{ n: number }> }).rows;
    expect(rows[0]?.n ?? 0).toBe(1);
  });

  it("added a nullable style_note column to customers", async () => {
    const res = await db.execute(sql`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'style_note'
    `);
    const rows = (res as unknown as { rows: Array<{ is_nullable: string }> })
      .rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_nullable).toBe("YES");
  });
});
