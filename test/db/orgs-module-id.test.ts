// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import { orgs } from "@/db/schema";

/**
 * Slice C-1 (module-skeleton): orgs.module_id column round-trip.
 *
 * Verifies the migration landed (column exists), nullable inserts work, and a
 * non-null string round-trips so future shell code can lookup a manifest by id.
 * No FK / CHECK constraint on the column by design — see docs/MODULES.md §6.3
 * (validation at the app boundary, not the DB, so tenants can switch modules
 * without DDL).
 */
describe("orgs.module_id (slice C-1)", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("exposes module_id as a nullable text column on orgs", async () => {
    // information_schema is the same on pglite + Neon (PostgreSQL-compat).
    const res = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'orgs' AND column_name = 'module_id'
    `);
    const rows = (res as unknown as {
      rows: { column_name: string; data_type: string; is_nullable: string }[];
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("text");
    expect(rows[0].is_nullable).toBe("YES");
  });

  it("round-trips a non-null module_id string", async () => {
    await db
      .update(orgs)
      .set({ moduleId: "aiya-jewelry" })
      .where(eq(orgs.id, 1));
    const after = await db
      .select({ moduleId: orgs.moduleId })
      .from(orgs)
      .where(eq(orgs.id, 1))
      .limit(1);
    expect(after[0].moduleId).toBe("aiya-jewelry");
  });

  it("accepts an explicit null module_id (core-only tenant)", async () => {
    // Insert a fresh org with module_id = null (default for inserts that omit
    // the field — but we set it explicitly to exercise the null path).
    await db.insert(orgs).values({
      name: "Core-only Co.",
      slug: "core-only-co",
      moduleId: null,
    });
    const row = await db
      .select({ moduleId: orgs.moduleId })
      .from(orgs)
      .where(eq(orgs.slug, "core-only-co"))
      .limit(1);
    expect(row).toHaveLength(1);
    expect(row[0].moduleId).toBeNull();
  });

  it("defaults module_id to null when the field is omitted on insert", async () => {
    await db.insert(orgs).values({
      name: "Implicit-null Co.",
      slug: "implicit-null-co",
    });
    const row = await db
      .select({ moduleId: orgs.moduleId })
      .from(orgs)
      .where(eq(orgs.slug, "implicit-null-co"))
      .limit(1);
    expect(row).toHaveLength(1);
    expect(row[0].moduleId).toBeNull();
  });
});
