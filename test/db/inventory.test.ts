// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";

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
    const s = await getInventorySummary(db); // defaults to AIYA org (1)
    expect(s.counts.Rings).toBe(5);        // 3 + 2, sold excluded
    expect(s.counts.Diamonds).toBe(10);
    expect(s.counts.Necklaces).toBe(0);    // the qty-1 row is org 999
    expect(s.counts.Earrings).toBe(0);     // zero-filled
    expect(s.total).toBe(15);
    expect(s.updatedAt).not.toBeNull();
  });

  it("returns all-zero counts and null updatedAt for an empty org", async () => {
    const s = await getInventorySummary(db);
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
    const s = await getInventorySummary(null as never);
    expect(s.counts.Rings).toBe(1240);
    expect(s.total).toBeGreaterThan(0);
  });
});
