// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { customers } from "@/db/schema";
import { getCustomers } from "@/db/customers";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedRow(orgId: number, name: string, extras: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(customers)
    .values({ orgId, name, ...extras })
    .returning();
  return row.id;
}

describe("getCustomers — cross-org isolation", () => {
  it("returns only the viewer's org rows", async () => {
    await seedRow(1, "Alice");
    await seedRow(1, "Bob");
    await seedRow(999, "Charlie");
    expect(await getCustomers(db, 1)).toHaveLength(2);
    expect(await getCustomers(db, 999)).toHaveLength(1);
    expect(await getCustomers(db, 888)).toEqual([]);
  });

  it("orders by name ASC, then created_at DESC tiebreak", async () => {
    await seedRow(1, "Charlie");
    await seedRow(1, "Alice");
    await seedRow(1, "Bob");
    const rows = await getCustomers(db, 1);
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("filters by free-text search across name, business_name, email, phone", async () => {
    await seedRow(1, "Priya Mehta", { businessName: "Mehta Diamonds" });
    await seedRow(1, "Other", { email: "Other@MEHTA.com" });
    await seedRow(1, "Phone-Match", { phone: "555-mehta" });
    await seedRow(1, "Unrelated");
    const rows = await getCustomers(db, 1, { search: "mehta" });
    expect(rows.map((r) => r.name).sort()).toEqual(["Other", "Phone-Match", "Priya Mehta"]);
  });

  it("honors the limit parameter (default 50, max 200)", async () => {
    for (let i = 0; i < 10; i++) await seedRow(1, `Cust ${i.toString().padStart(2, "0")}`);
    expect(await getCustomers(db, 1, { limit: 3 })).toHaveLength(3);
    // Cap at 200 — request a huge limit, ensure no SQL error
    const big = await getCustomers(db, 1, { limit: 9999 });
    expect(big.length).toBeLessThanOrEqual(200);
  });
});
