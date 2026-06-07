// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids } from "@/db/schema";
import { setInventoryItemBidMode, __setTestDb } from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { vi.clearAllMocks(); await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function seedItem(ownerOrgId: number, bidMode: "single" | "history" | null = null) {
  const [row] = await db.insert(inventoryItems).values({
    orgId: ownerOrgId, category: "Diamonds", name: "x", quantity: 1, status: "in_stock",
    unitCostCents: 100, retailPriceCents: 200, bidMode,
  }).returning();
  return row.id;
}

describe("setInventoryItemBidMode", () => {
  it("owner can toggle null -> single -> history -> null", async () => {
    const itemId = await seedItem(1, null);
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: "single" })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBe("single");
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: "history" })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBe("history");
    expect((await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null })).ok).toBe(true);
    expect((await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId)))[0].m).toBeNull();
  });

  it("non-owner toggle is a silent no-op (no mutation)", async () => {
    const itemId = await seedItem(1, "single");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });
    const res = await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null });
    expect(res).toEqual({ ok: true }); // slice-15 convention — silent no-op
    const [after] = await db.select({ m: inventoryItems.bidMode }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
    expect(after.m).toBe("single"); // unchanged
  });

  it("toggling bid_mode to null does NOT mutate existing bid rows", async () => {
    const itemId = await seedItem(1, "single");
    await db.insert(inventoryBids).values([
      { inventoryItemId: itemId, bidderOrgId: 999, bidderOrgLabel: "B1", priceCents: 100 },
      { inventoryItemId: itemId, bidderOrgId: 888, bidderOrgLabel: "B2", priceCents: 200 },
    ]);
    await setInventoryItemBidMode({ inventoryItemId: itemId, mode: null });
    const bids = await db.select().from(inventoryBids);
    expect(bids).toHaveLength(2);
    expect(bids.every((b) => b.status === "pending")).toBe(true);
    expect(bids.every((b) => b.decidedAt === null)).toBe(true);
  });
});
