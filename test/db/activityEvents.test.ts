// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { getOrgActivity, getEntityActivity } from "@/db/activityEvents";

async function insertEvents(
  db: Db,
  rows: Array<Partial<typeof schema.activityEvents.$inferInsert>>,
) {
  for (const r of rows) {
    await db.insert(schema.activityEvents).values({
      orgId: 1, entityType: "customer", entityId: 1, verb: "created", summary: "x",
      ...r,
    });
    // Force monotonic created_at when iterating fast — pglite resolves to
    // microseconds but we want guaranteed ordering for assertions.
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("getOrgActivity — org-wide reader", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => {
    await resetSharedDb();
    // org id=1 is preserved by resetSharedDb; ensure org id=2 exists for cross-org tests
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'two', 'Two') ON CONFLICT (id) DO NOTHING`);
  });
  afterAll(async () => { await closeSharedDb(); });

  it("returns only events for the viewer's org (cross-org isolation)", async () => {
    await insertEvents(db, [
      { orgId: 1, summary: "org1-a" },
      { orgId: 2, summary: "org2-a" },
      { orgId: 1, summary: "org1-b" },
    ]);
    const rows = await getOrgActivity(db, 1);
    expect(rows.map((r) => r.summary).sort()).toEqual(["org1-a", "org1-b"]);
  });

  it("orders DESC by created_at then id", async () => {
    await insertEvents(db, [
      { orgId: 1, summary: "first" },
      { orgId: 1, summary: "second" },
      { orgId: 1, summary: "third" },
    ]);
    const rows = await getOrgActivity(db, 1);
    expect(rows.map((r) => r.summary)).toEqual(["third", "second", "first"]);
  });

  it("default limit is 50 — clamps to 200 maximum", async () => {
    for (let i = 0; i < 220; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: i + 1, verb: "created", summary: `c${i}`,
      });
    }
    expect((await getOrgActivity(db, 1)).length).toBe(50);
    expect((await getOrgActivity(db, 1, { limit: 100 })).length).toBe(100);
    expect((await getOrgActivity(db, 1, { limit: 500 })).length).toBe(200);
  });

  it("filters by entityTypes when provided", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", summary: "c1" },
      { orgId: 1, entityType: "deal", summary: "d1" },
      { orgId: 1, entityType: "inventory_item", summary: "i1" },
      { orgId: 1, entityType: "customer", summary: "c2" },
    ]);
    const rows = await getOrgActivity(db, 1, { entityTypes: ["customer"] });
    expect(rows.map((r) => r.summary).sort()).toEqual(["c1", "c2"]);

    const mixed = await getOrgActivity(db, 1, { entityTypes: ["customer", "deal"] });
    expect(mixed.length).toBe(3);
  });

  it("paginates via beforeId cursor — page 2 never overlaps page 1", async () => {
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: i + 1, verb: "created", summary: `c${i}`,
      });
    }
    const page1 = await getOrgActivity(db, 1, { limit: 2 });
    expect(page1.length).toBe(2);
    const cursor = page1[page1.length - 1]!.id;
    const page2 = await getOrgActivity(db, 1, { limit: 2, beforeId: cursor });
    expect(page2.length).toBe(2);
    const overlap = page1.map((r) => r.id).filter((id) => page2.some((r) => r.id === id));
    expect(overlap).toEqual([]);
  });
});

describe("getEntityActivity — entity-scoped reader", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => {
    await resetSharedDb();
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'two', 'Two') ON CONFLICT (id) DO NOTHING`);
  });
  afterAll(async () => { await closeSharedDb(); });

  it("returns only events for the given (entityType, entityId) pair", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 7, summary: "c7-a" },
      { orgId: 1, entityType: "customer", entityId: 8, summary: "c8-a" },
      { orgId: 1, entityType: "deal", entityId: 7, summary: "d7" },
      { orgId: 1, entityType: "customer", entityId: 7, summary: "c7-b" },
    ]);
    const rows = await getEntityActivity(db, 1, "customer", 7);
    expect(rows.map((r) => r.summary).sort()).toEqual(["c7-a", "c7-b"]);
  });

  it("enforces cross-org isolation (org 2 events never returned to org 1 viewer)", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 5, summary: "org1-c5" },
      { orgId: 2, entityType: "customer", entityId: 5, summary: "org2-c5" },
    ]);
    const rows = await getEntityActivity(db, 1, "customer", 5);
    expect(rows.map((r) => r.summary)).toEqual(["org1-c5"]);
  });

  it("paginates via beforeId on the entity-scoped path", async () => {
    for (let i = 0; i < 4; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: 9, verb: "updated", summary: `u${i}`,
      });
    }
    const page1 = await getEntityActivity(db, 1, "customer", 9, { limit: 2 });
    expect(page1.length).toBe(2);
    const page2 = await getEntityActivity(db, 1, "customer", 9, { limit: 2, beforeId: page1.at(-1)!.id });
    expect(page2.length).toBe(2);
    expect(page1.map((r) => r.id).filter((id) => page2.some((r) => r.id === id))).toEqual([]);
  });

  it("returns empty array when no matching events exist", async () => {
    await insertEvents(db, [{ orgId: 1, entityType: "deal", entityId: 1, summary: "d1" }]);
    const rows = await getEntityActivity(db, 1, "customer", 99);
    expect(rows).toEqual([]);
  });

  it("clamps limit at 200", async () => {
    for (let i = 0; i < 220; i++) {
      await db.insert(schema.activityEvents).values({
        orgId: 1, entityType: "customer", entityId: 1, verb: "updated", summary: `u${i}`,
      });
    }
    const rows = await getEntityActivity(db, 1, "customer", 1, { limit: 999 });
    expect(rows.length).toBe(200);
  });
});
