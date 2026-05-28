// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";
import {
  createInventoryItem, updateInventoryItem, deleteInventoryItem, __setTestDb,
} from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

describe("inventory server actions", () => {
  it("creates an item that shows up in the summary", async () => {
    const res = await createInventoryItem({
      category: "Rings", name: "Solitaire", quantity: 4, status: "in_stock",
      unitCostCents: 1000, retailPriceCents: 2000, metal: "gold", weightMg: 4000,
    });
    expect(res).toEqual({ ok: true });
    const s = await getInventorySummary(db, 1);
    expect(s.counts.Rings).toBe(4);
  });

  it("rejects invalid input with a typed error, no throw", async () => {
    const res = await createInventoryItem({
      category: "Rings", name: "", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/name/);
  });

  it("updates and deletes an item", async () => {
    await createInventoryItem({
      category: "Diamonds", name: "Stone", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    const [row] = await db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(await updateInventoryItem({
      id: row.id, category: "Diamonds", name: "Stone", quantity: 7, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    })).toEqual({ ok: true });
    expect((await getInventorySummary(db, 1)).counts.Diamonds).toBe(7);
    expect(await deleteInventoryItem(row.id)).toEqual({ ok: true });
    expect((await getInventorySummary(db, 1)).total).toBe(0);
  });

  it("surfaces unauthorized as a typed error", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await createInventoryItem({
      category: "Rings", name: "x", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });
});

describe("inventory writes disabled in demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("createInventoryItem returns the disabled error and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await createInventoryItem({
      category: "Rings", name: "X", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });
});

describe("inventory cross-org tenancy enforcement", () => {
  it("createInventoryItem stamps the row with session.orgId (not a default)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 999,
    });
    const res = await createInventoryItem({
      category: "Rings", name: "Org999 ring", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select({ orgId: inventoryItems.orgId, name: inventoryItems.name })
      .from(inventoryItems);
    expect(row.orgId).toBe(999);
    expect(row.name).toBe("Org999 ring");
  });

  it("updateInventoryItem with an id from another org cannot reach that row", async () => {
    // Seed a row in org 999.
    await db.insert(inventoryItems).values({
      orgId: 999, category: "Diamonds", name: "untouchable",
      quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 0,
    });
    const [target] = await db.select({ id: inventoryItems.id }).from(inventoryItems);

    // Now the session is org 1, attacker tries to update org 999's row by id.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await updateInventoryItem({
      id: target.id, category: "Diamonds", name: "PWNED", quantity: 99, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });

    // Verify the row in org 999 is unchanged.
    const [after] = await db.select({ name: inventoryItems.name, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, target.id));
    expect(after.name).toBe("untouchable");
    expect(after.quantity).toBe(1);
  });

  it("deleteInventoryItem with an id from another org cannot delete that row", async () => {
    await db.insert(inventoryItems).values({
      orgId: 999, category: "Rings", name: "survivor",
      quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 0,
    });
    const [target] = await db.select({ id: inventoryItems.id }).from(inventoryItems);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await deleteInventoryItem(target.id);

    const all = await db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(all.map((r) => r.id)).toContain(target.id); // still there
  });
});

describe("getInventorySummary cross-org isolation", () => {
  it("returns only the requested org's rows", async () => {
    await db.insert(inventoryItems).values([
      { orgId: 1, category: "Rings", name: "aiya-ring", quantity: 3, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 1, category: "Diamonds", name: "aiya-dia", quantity: 2, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 999, category: "Rings", name: "other-ring", quantity: 100, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 999, category: "Necklaces", name: "other-neck", quantity: 50, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
    ]);
    const aiya = await getInventorySummary(db, 1);
    expect(aiya.counts.Rings).toBe(3);
    expect(aiya.counts.Diamonds).toBe(2);
    expect(aiya.counts.Necklaces).toBe(0); // belongs to 999
    expect(aiya.total).toBe(5);

    const other = await getInventorySummary(db, 999);
    expect(other.counts.Rings).toBe(100);
    expect(other.counts.Necklaces).toBe(50);
    expect(other.counts.Diamonds).toBe(0); // belongs to AIYA
    expect(other.total).toBe(150);
  });
});
