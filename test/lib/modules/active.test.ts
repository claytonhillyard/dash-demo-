// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";
import { orgs } from "@/db/schema";
import { getActiveModule } from "@/lib/modules/active";

/**
 * Slice C-1 (module-skeleton): contract for `getActiveModule(orgId, db)`.
 *
 * The registry is empty in C-1, so EVERY non-null module_id should resolve to
 * null (no matching manifest → "core only" UX). C-2 lands the first real
 * manifest (aiya-jewelry) and adds a positive-case test alongside these.
 */
describe("getActiveModule (slice C-1, empty registry)", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(() => resetSharedDb());
  afterEach(() => {
    // vi.stubEnv handles restore at the end of the test file; this keeps each
    // case independent in case earlier ones stub NEXT_PUBLIC_DEMO_MODE.
    vi.unstubAllEnvs();
  });
  afterAll(() => closeSharedDb());

  it("returns null when module_id is null on the org", async () => {
    // Default seed leaves module_id null on org 1.
    const result = await getActiveModule(1, db);
    expect(result).toBeNull();
  });

  it("returns null when module_id is set but the registry is empty (C-1)", async () => {
    // C-1 ships MODULES = {}. Any non-null id is unknown — must collapse to
    // null so the shell renders bare core, not throw.
    await db
      .update(orgs)
      .set({ moduleId: "aiya-jewelry" })
      .where(eq(orgs.id, 1));
    const result = await getActiveModule(1, db);
    expect(result).toBeNull();
  });

  it("returns null for an arbitrary unknown module_id", async () => {
    await db
      .update(orgs)
      .set({ moduleId: "not-a-real-module" })
      .where(eq(orgs.id, 1));
    const result = await getActiveModule(1, db);
    expect(result).toBeNull();
  });

  it("returns null when the orgId has no matching row", async () => {
    // Defensive: a missing orgId is the same "core only" outcome, not a
    // thrown error. The shell falls back to bare-core safely.
    const result = await getActiveModule(99_999, db);
    expect(result).toBeNull();
  });

  it("short-circuits to null in demo mode regardless of module_id", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    await db
      .update(orgs)
      .set({ moduleId: "aiya-jewelry" })
      .where(eq(orgs.id, 1));
    const result = await getActiveModule(1, db);
    expect(result).toBeNull();
  });
});
