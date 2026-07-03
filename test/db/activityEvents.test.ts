// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { getOrgActivity, getEntityActivity, getCustomerActivityStats } from "@/db/activityEvents";

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

describe("getOrgActivity / getEntityActivity — demo mode", () => {
  const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.resetModules();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO;
    vi.resetModules();
  });

  it("getOrgActivity returns DEMO_ACTIVITY entries in DESC order", async () => {
    const mod = await import("@/db/activityEvents");
    const db = await getSharedDb();
    const rows = await mod.getOrgActivity(db, 1, { limit: 50 });
    expect(rows.length).toBe(10);
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.createdAt.getTime());
  });

  it("getEntityActivity filters DEMO_ACTIVITY by entity (customer 2201 has 2 events)", async () => {
    const mod = await import("@/db/activityEvents");
    const db = await getSharedDb();
    const rows = await mod.getEntityActivity(db, 1, "customer", 2201);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.entityType === "customer" && r.entityId === 2201)).toBe(true);
  });

  it("getCustomerActivityStats: customer 2201 has eventsLast30d 2, distinctVerbs30d 2 (created 9001 + updated 9005, both within 24h of demo NOW)", async () => {
    const mod = await import("@/db/activityEvents");
    const db = await getSharedDb();
    const stats = await mod.getCustomerActivityStats(db, 1);
    const s = stats.get(2201);
    expect(s).toBeDefined();
    expect(s!.entityId).toBe(2201);
    expect(s!.eventsLast30d).toBe(2);
    expect(s!.distinctVerbs30d).toBe(2);
    expect(s!.lastActivityAt).toBeInstanceOf(Date);
  });
});

describe("getCustomerActivityStats — aggregate reader", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => {
    await resetSharedDb();
    await db.execute(sql`INSERT INTO orgs (id, slug, name) VALUES (2, 'two', 'Two') ON CONFLICT (id) DO NOTHING`);
  });
  afterAll(async () => { await closeSharedDb(); });

  it("groups per customer id with correct eventsLast30d counts", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 1, verb: "created", summary: "c1-a" },
      { orgId: 1, entityType: "customer", entityId: 1, verb: "updated", summary: "c1-b" },
      { orgId: 1, entityType: "customer", entityId: 2, verb: "created", summary: "c2-a" },
    ]);
    const stats = await getCustomerActivityStats(db, 1);
    expect(stats.size).toBe(2);
    expect(stats.get(1)!.eventsLast30d).toBe(2);
    expect(stats.get(2)!.eventsLast30d).toBe(1);
  });

  it("lastActivityAt reflects an OLD event (unwindowed) even though it's excluded from the 30d window count", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 3, verb: "created", summary: "aged" },
    ]);
    await db.execute(
      sql`UPDATE activity_events SET created_at = now() - interval '45 days' WHERE entity_id = 3 AND org_id = 1`,
    );
    const stats = await getCustomerActivityStats(db, 1);
    const s = stats.get(3);
    expect(s).toBeDefined();
    // Excluded from the 30d window — the only event for this customer is 45d old.
    expect(s!.eventsLast30d).toBe(0);
    expect(s!.distinctVerbs30d).toBe(0);
    // But lastActivityAt is unwindowed — it still reflects the 45-day-old event,
    // NOT null. Assert it's roughly 45 days ago, not "now".
    const daysSince = (Date.now() - s!.lastActivityAt.getTime()) / 86_400_000;
    expect(daysSince).toBeGreaterThan(44);
    expect(daysSince).toBeLessThan(46);
  });

  it("counts distinct verbs within the 30d window (3 events, 2 distinct verbs -> 2)", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 4, verb: "created", summary: "v1" },
      { orgId: 1, entityType: "customer", entityId: 4, verb: "updated", summary: "v2" },
      { orgId: 1, entityType: "customer", entityId: 4, verb: "updated", summary: "v3" },
    ]);
    const stats = await getCustomerActivityStats(db, 1);
    const s = stats.get(4);
    expect(s!.eventsLast30d).toBe(3);
    expect(s!.distinctVerbs30d).toBe(2);
  });

  it("enforces cross-org isolation (org 2 events invisible to org 1 viewer)", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 5, verb: "created", summary: "org1-c5" },
      { orgId: 2, entityType: "customer", entityId: 5, verb: "created", summary: "org2-c5" },
    ]);
    const stats = await getCustomerActivityStats(db, 1);
    expect(stats.has(5)).toBe(true);
    expect(stats.get(5)!.eventsLast30d).toBe(1);

    const statsOrg2 = await getCustomerActivityStats(db, 2);
    expect(statsOrg2.has(5)).toBe(true);
    expect(statsOrg2.get(5)!.eventsLast30d).toBe(1);
  });

  it("returns an empty Map when there are no customer activity events", async () => {
    const stats = await getCustomerActivityStats(db, 1);
    expect(stats.size).toBe(0);
    expect(stats instanceof Map).toBe(true);
  });

  it("excludes non-customer entity_types from the grouping", async () => {
    await insertEvents(db, [
      { orgId: 1, entityType: "customer", entityId: 6, verb: "created", summary: "cust" },
      { orgId: 1, entityType: "deal", entityId: 6, verb: "created", summary: "deal-same-id" },
      { orgId: 1, entityType: "inventory_item", entityId: 6, verb: "created", summary: "inv-same-id" },
    ]);
    const stats = await getCustomerActivityStats(db, 1);
    expect(stats.size).toBe(1);
    expect(stats.get(6)!.eventsLast30d).toBe(1);
  });
});
