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
 * Tests that specifically verify per-instance isolation or migration behavior
 * (e.g. test/db/client.test.ts) should keep using `createTestDb()`.
 */

let cached: { client: PGlite; db: Db } | null = null;
let tableNames: string[] | null = null;

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
  return db;
}

/** Wipe every user table; preserves schema + sequences are reset to 1. Sub-ms. */
export async function resetSharedDb(): Promise<void> {
  if (!cached || !tableNames || tableNames.length === 0) return;
  const quoted = tableNames.map((t) => `"${t}"`).join(", ");
  await cached.db.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`));
}

/** Close the underlying pglite instance. Call in afterAll. */
export async function closeSharedDb(): Promise<void> {
  if (cached) {
    await cached.client.close();
    cached = null;
    tableNames = null;
  }
}
