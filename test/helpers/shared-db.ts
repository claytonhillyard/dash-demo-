import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { type Db } from "@/db/client";

/**
 * One migrated pglite shared across every test in the calling file.
 *
 * Why this exists: `createTestDb()` boots a fresh pglite WASM instance per call
 * (~5-6s each). Most DB tests called it in `beforeEach`, so a 9-test file paid
 * ~45-55s in boot cost alone. Booting once per file (in `beforeAll`) and
 * wiping data between tests (`TRUNCATE … CASCADE`) gives the same isolation
 * guarantee for a tiny fraction of the time. Vitest's default `isolate: true`
 * re-imports this module per test file, so the module-level singleton is
 * naturally file-scoped — no cross-file leakage.
 *
 * Multi-tenant seeding (slice 3 + slice 4): the migration's hand-edited block
 * already seeds AIYA at id=1, but the post-migrate `seedOrgs()` step below
 * also inserts two fixture orgs:
 *   - id=999 ("Fixture Org") — original slice-3 cross-org isolation tests.
 *   - id=888 ("Partner Org") — slice-4 cross-circle tests use this as the
 *     "viewer with no circle memberships" or "partner that shares a circle
 *     with AIYA", depending on the test's setup.
 * After every `resetSharedDb()` we re-insert all three rows (TRUNCATE CASCADE
 * wipes them) so every test starts from the same baseline.
 *
 * Tests that specifically verify per-instance isolation or migration behavior
 * (e.g. test/db/client.test.ts, test/db/orgs-migration.test.ts) should keep
 * using `createTestDb()` so they observe the seeded id=1 (and no 999) state.
 */

let cached: { client: PGlite; db: Db } | null = null;
let tableNames: string[] | null = null;

async function seedOrgs(db: Db): Promise<void> {
  // Idempotent: re-inserting after the migration is a no-op via ON CONFLICT.
  // id=1 = AIYA (slice 3), id=999 = primary fixture (slice 3 cross-org isolation),
  // id=888 = partner fixture (slice 4 cross-circle tests — viewer with no
  // circle memberships, paired with AIYA which IS in a circle).
  await db.execute(sql`
    INSERT INTO orgs (id, name, slug) VALUES
      (1,   'AIYA Designs', 'aiya'),
      (999, 'Fixture Org',  'fixture'),
      (888, 'Partner Org',  'partner')
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('orgs', 'id'),
      GREATEST(999, (SELECT COALESCE(MAX(id), 1) FROM orgs))
    );
  `);
}

export async function getSharedDb(): Promise<Db> {
  if (cached) return cached.db;
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  cached = { client, db };
  // Discover user tables once so reset stays schema-agnostic as the project grows.
  // The __drizzle_migrations bookkeeping table is excluded — we want migrations
  // to stay applied across test-to-test resets.
  const res = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_drizzle%' ESCAPE '\\'
  `);
  const rows = (res as unknown as { rows: { tablename: string }[] }).rows;
  tableNames = rows.map((r) => r.tablename);
  await seedOrgs(db);
  return db;
}

/** Wipe every user table; preserves schema + sequences are reset to 1. Sub-ms.
 *  Re-seeds orgs immediately after the truncate because the FK on every
 *  tenanted table needs id=1 and id=999 to exist before the next test runs. */
export async function resetSharedDb(): Promise<void> {
  if (!cached || !tableNames || tableNames.length === 0) return;
  const quoted = tableNames.map((t) => `"${t}"`).join(", ");
  await cached.db.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`));
  await seedOrgs(cached.db);
}

/** Close the underlying pglite instance. Call in afterAll. */
export async function closeSharedDb(): Promise<void> {
  if (cached) {
    await cached.client.close();
    cached = null;
    tableNames = null;
  }
}
