// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function insert(overrides: Partial<typeof deals.$inferInsert> = {}) {
  await db.insert(deals).values({
    orgId: 1,
    kind: "SELL",
    category: "Diamond",
    subject: "test",
    quantity: 1,
    priceCents: 100,
    postedByLabel: "boss",
    ...overrides,
  });
}

describe("getActiveDeals", () => {
  it("returns only Open deals, newest first", async () => {
    await insert({ subject: "older open", createdAt: new Date(Date.now() - 60_000) });
    await insert({ subject: "newer open" });
    await insert({ subject: "filled", status: "Filled" });
    await insert({ subject: "withdrawn", status: "Withdrawn" });
    const rows = await getActiveDeals(db, 1);
    expect(rows.map((r) => r.subject)).toEqual(["newer open", "older open"]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 8; i++) await insert({ subject: `d${i}` });
    const rows = await getActiveDeals(db, 1, 3);
    expect(rows).toHaveLength(3);
  });

  it("returns [] when the table is empty", async () => {
    const rows = await getActiveDeals(db, 1);
    expect(rows).toEqual([]);
  });
});

describe("getAllDeals", () => {
  it("returns all statuses when no filter is supplied", async () => {
    await insert({ subject: "a" });
    await insert({ subject: "b", status: "Filled" });
    await insert({ subject: "c", status: "Withdrawn" });
    const rows = await getAllDeals(db, 1);
    expect(rows).toHaveLength(3);
  });

  it("filters by status", async () => {
    await insert({ subject: "open" });
    await insert({ subject: "filled", status: "Filled" });
    const rows = await getAllDeals(db, 1, { status: "Filled" });
    expect(rows.map((r) => r.subject)).toEqual(["filled"]);
  });

  it("filters by kind", async () => {
    await insert({ subject: "sell", kind: "SELL" });
    await insert({ subject: "buy", kind: "BUY" });
    const rows = await getAllDeals(db, 1, { kind: "BUY" });
    expect(rows.map((r) => r.subject)).toEqual(["buy"]);
  });

  it("filters by category", async () => {
    await insert({ subject: "diamond", category: "Diamond" });
    await insert({ subject: "gem", category: "Gem" });
    const rows = await getAllDeals(db, 1, { category: "Gem" });
    expect(rows.map((r) => r.subject)).toEqual(["gem"]);
  });

  it("scopes to the supplied org (tenancy isolation)", async () => {
    await insert({ subject: "aiya", orgId: 1 });
    await insert({ subject: "otherOrg", orgId: 999 });
    expect((await getActiveDeals(db, 1)).map((r) => r.subject)).toEqual(["aiya"]);
    expect((await getActiveDeals(db, 999)).map((r) => r.subject)).toEqual(["otherOrg"]);
    expect((await getAllDeals(db, 1)).map((r) => r.subject)).toEqual(["aiya"]);
    expect((await getAllDeals(db, 999)).map((r) => r.subject)).toEqual(["otherOrg"]);
  });
});

describe("getAllDeals cross-org isolation across filters", () => {
  it("scopes to orgId even when status filter is active", async () => {
    await insert({ subject: "aiya-filled", status: "Filled", orgId: 1 });
    await insert({ subject: "other-filled", status: "Filled", orgId: 999 });
    const rows = await getAllDeals(db, 1, { status: "Filled" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-filled"]);
  });

  it("scopes to orgId even when kind filter is active", async () => {
    await insert({ subject: "aiya-buy", kind: "BUY", orgId: 1 });
    await insert({ subject: "other-buy", kind: "BUY", orgId: 999 });
    const rows = await getAllDeals(db, 1, { kind: "BUY" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-buy"]);
  });

  it("scopes to orgId even when category filter is active", async () => {
    await insert({ subject: "aiya-gem", category: "Gem", orgId: 1 });
    await insert({ subject: "other-gem", category: "Gem", orgId: 999 });
    const rows = await getAllDeals(db, 1, { category: "Gem" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-gem"]);
  });
});

describe("demo-mode short-circuit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("getActiveDeals returns seed slice without DB access", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getActiveDeals(db, 1, 5);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.subject).toMatch(/demo · simulated/);
  });

  it("getActiveDeals respects limit in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getActiveDeals(db, 1, 2);
    expect(rows).toHaveLength(2);
  });

  it("getAllDeals returns full seed in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const rows = await getAllDeals(db, 1);
    expect(rows).toHaveLength(5);
  });
});
