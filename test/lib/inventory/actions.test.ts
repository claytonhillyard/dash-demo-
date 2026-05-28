// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";
import {
  createInventoryItem, updateInventoryItem, deleteInventoryItem, __setTestDb,
} from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";

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
    const s = await getInventorySummary(db);
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
    expect((await getInventorySummary(db)).counts.Diamonds).toBe(7);
    expect(await deleteInventoryItem(row.id)).toEqual({ ok: true });
    expect((await getInventorySummary(db)).total).toBe(0);
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
