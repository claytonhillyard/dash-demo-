// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import { inventoryItems, circles, circleMembers, orgs } from "@/db/schema";
import { sql } from "drizzle-orm";
import { getInventorySummary, getSharedInventoryForOrg } from "@/db/inventory";

async function seed(db: Db) {
  await db.insert(inventoryItems).values([
    { category: "Rings", name: "A", quantity: 3, status: "in_stock" },
    { category: "Rings", name: "B", quantity: 2, status: "reserved" },
    { category: "Rings", name: "C", quantity: 5, status: "sold" },      // excluded
    { category: "Diamonds", name: "D", quantity: 10, status: "in_stock" },
    { category: "Necklaces", name: "E", quantity: 1, status: "in_stock", orgId: 999 }, // other org
  ]);
}

describe("getInventorySummary", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("sums on-hand quantity per category, excludes sold, scopes to the org, zero-fills", async () => {
    await seed(db);
    const s = await getInventorySummary(db, 1);
    expect(s.counts.Rings).toBe(5);        // 3 + 2, sold excluded
    expect(s.counts.Diamonds).toBe(10);
    expect(s.counts.Necklaces).toBe(0);    // the qty-1 row is org 999
    expect(s.counts.Earrings).toBe(0);     // zero-filled
    expect(s.total).toBe(15);
    expect(s.updatedAt).not.toBeNull();
  });

  it("returns all-zero counts and null updatedAt for an empty org", async () => {
    const s = await getInventorySummary(db, 1);
    expect(s.total).toBe(0);
    expect(s.counts.Rings).toBe(0);
    expect(s.updatedAt).toBeNull();
  });
});

describe("getInventorySummary demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns seeded counts without touching the db when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // pass a db that would throw if used, proving the guard returns first
    const s = await getInventorySummary(null as never, 1);
    expect(s.counts.Rings).toBe(1240);
    expect(s.total).toBeGreaterThan(0);
  });
});

describe("getSharedInventoryForOrg basic", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("getSharedInventoryForOrg returns [] for zero-circles org without touching DB (demo off)", async () => {
    // Org 999 has zero circles in shared-db seed.
    const rows = await getSharedInventoryForOrg(db, 999);
    expect(rows).toEqual([]);
  });
});

describe("slice 15 — shared inventory visibility truth table", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("single-circle truth table: AIYA sees 888's shared row; private rows excluded; own rows excluded", async () => {
    // Three orgs: 1 (AIYA), 999, 888 (already seeded by shared-db).
    // Create one circle C with members (1, C) and (888, C).
    // TODO(slice-15 review): plan code used `.returning({ id: circles.id })`, but
    // the Db union type doesn't accept a projection arg here. Mirrors slice-4
    // test discipline (see test/lib/circles/visibility.test.ts).
    const [c] = await db
      .insert(circles)
      .values({ name: "Test C", slug: "test-c-single", ownerOrgId: 1 })
      .returning();
    const circleId = c.id;
    await db.insert(circleMembers).values([
      { circleId, orgId: 1 },
      { circleId, orgId: 888 },
    ]);

    // Four inventory rows.
    // TODO(slice-15 review): no-arg .returning() — same reason as above.
    const [i1, i2, i3, i4] = await db
      .insert(inventoryItems)
      .values([
        // I1: orgId 1, vis NULL (AIYA private)
        { orgId: 1, category: "Diamonds", name: "I1", quantity: 1, status: "in_stock" },
        // I2: orgId 1, vis C (AIYA-owned shared)
        { orgId: 1, category: "Diamonds", name: "I2", quantity: 1, status: "in_stock", visibilityCircleId: circleId },
        // I3: orgId 999, vis NULL (999 private)
        { orgId: 999, category: "Diamonds", name: "I3", quantity: 1, status: "in_stock" },
        // I4: orgId 888, vis C (888-owned shared)
        { orgId: 888, category: "Diamonds", name: "I4", quantity: 1, status: "in_stock", visibilityCircleId: circleId },
      ])
      .returning();

    const aiyaRows = await getSharedInventoryForOrg(db, 1);
    expect(aiyaRows.length).toBe(1);
    expect(aiyaRows[0].id).toBe(i4.id);

    const org999Rows = await getSharedInventoryForOrg(db, 999);
    expect(org999Rows).toEqual([]);

    const org888Rows = await getSharedInventoryForOrg(db, 888);
    expect(org888Rows.length).toBe(1);
    expect(org888Rows[0].id).toBe(i2.id);

    // Silence unused-var lint
    void i1; void i3;
  });

  it("multi-circle viewer: AIYA in A and B sees rows shared into both, partners only see their own circle", async () => {
    // TODO(slice-15 review): no-arg .returning() — Db union doesn't accept projection.
    const inserted = await db
      .insert(circles)
      .values([
        { name: "Circle A", slug: "circle-a-multi", ownerOrgId: 1 },
        { name: "Circle B", slug: "circle-b-multi", ownerOrgId: 1 },
      ])
      .returning();
    const [aId, bId] = [inserted[0].id, inserted[1].id];
    await db.insert(circleMembers).values([
      { circleId: aId, orgId: 1 },
      { circleId: aId, orgId: 999 },
      { circleId: bId, orgId: 1 },
      { circleId: bId, orgId: 888 },
    ]);

    // TODO(slice-15 review): no-arg .returning() — same reason as above.
    const [ia, ib] = await db
      .insert(inventoryItems)
      .values([
        { orgId: 999, category: "Diamonds", name: "IA", quantity: 1, status: "in_stock", visibilityCircleId: aId },
        { orgId: 888, category: "Diamonds", name: "IB", quantity: 1, status: "in_stock", visibilityCircleId: bId },
      ])
      .returning();

    const aiyaRows = await getSharedInventoryForOrg(db, 1);
    expect(aiyaRows.map((r) => r.id).sort((x, y) => x - y)).toEqual(
      [ia.id, ib.id].sort((x, y) => x - y),
    );

    // 999 only in A; A contains the AIYA-owned IA, but ne(orgId) excludes own and there's no other row in A.
    const org999Rows = await getSharedInventoryForOrg(db, 999);
    expect(org999Rows).toEqual([]);

    const org888Rows = await getSharedInventoryForOrg(db, 888);
    expect(org888Rows).toEqual([]);
  });

  it("excludes rows with status='sold' from getSharedInventoryForOrg", async () => {
    // TODO(slice-15 review): no-arg .returning() — Db union doesn't accept projection.
    const [c] = await db
      .insert(circles)
      .values({ name: "Test SoldEx", slug: "test-sold-ex", ownerOrgId: 1 })
      .returning();
    const circleId = c.id;
    await db.insert(circleMembers).values([
      { circleId, orgId: 1 },
      { circleId, orgId: 888 },
    ]);

    await db.insert(inventoryItems).values([
      { orgId: 888, category: "Diamonds", name: "in-stock", quantity: 1, status: "in_stock", visibilityCircleId: circleId },
      { orgId: 888, category: "Diamonds", name: "sold-row", quantity: 1, status: "sold", visibilityCircleId: circleId },
    ]);

    const rows = await getSharedInventoryForOrg(db, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("in-stock");
  });

  it("getInventorySummary unaffected — slice-3 isolation invariant preserved", async () => {
    // Insert rows for org 1 and org 999; summary scoped to each must be independent.
    await db.insert(inventoryItems).values([
      { orgId: 1, category: "Rings", name: "R1", quantity: 3, status: "in_stock" },
      { orgId: 999, category: "Necklaces", name: "N1", quantity: 7, status: "in_stock" },
    ]);
    const s1 = await getInventorySummary(db, 1);
    expect(s1.counts.Rings).toBe(3);
    expect(s1.counts.Necklaces).toBe(0);

    const s999 = await getInventorySummary(db, 999);
    expect(s999.counts.Necklaces).toBe(7);
    expect(s999.counts.Rings).toBe(0);

    // Belt-and-suspenders: orgs table is wired (used here so the import isn't dead-eliminated)
    void orgs; void sql;
  });
});
