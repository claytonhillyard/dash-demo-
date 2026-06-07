// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids } from "@/db/schema";
import { withdrawInventoryBid, rejectInventoryBid, __setTestDb } from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => {
  // resetAllMocks restores the default `mockImplementation` per-test, so a
  // prior test's `mockResolvedValue` (sticky) doesn't leak. The default
  // implementation from the top-level vi.mock factory is preserved.
  vi.resetAllMocks();
  (requireSession as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async () => ({ user: "boss", orgId: 1 }),
  );
  await resetSharedDb();
});
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function seed() {
  const [item] = await db.insert(inventoryItems).values({
    orgId: 1, category: "Diamonds", name: "x", quantity: 1, status: "in_stock",
    unitCostCents: 100, retailPriceCents: 200, bidMode: "single",
  }).returning();
  const [bid] = await db.insert(inventoryBids).values({
    inventoryItemId: item.id, bidderOrgId: 999, bidderOrgLabel: "B", priceCents: 1,
  }).returning();
  return { item, bid };
}

describe("withdrawInventoryBid", () => {
  it("bidder can withdraw their own pending bid", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await withdrawInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: true });
    const [after] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("withdrawn");
    expect(after.decidedAt).not.toBeNull();
  });

  it("forbids withdraw by non-bidder", async () => {
    const { bid } = await seed();
    const res = await withdrawInventoryBid({ bidId: bid.id }); // session orgId = 1 (owner, not bidder)
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids withdraw on accepted bid", async () => {
    const { bid } = await seed();
    await db.update(inventoryBids).set({ status: "accepted", decidedAt: new Date() }).where(eq(inventoryBids.id, bid.id));
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await withdrawInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  // TODO(slice-18 review): Plan placed this test 2nd; moved to last because
  // mockResolvedValue (vs mockResolvedValueOnce) is sticky across tests, and
  // vi.clearAllMocks() doesn't reset mock IMPLEMENTATIONS — only call data.
  // Slice-16's bid-withdraw.test.ts uses the same ordering convention.
  it("is idempotent (double-withdraw returns ok with no further changes)", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: "p", orgId: 999 });
    const first = await withdrawInventoryBid({ bidId: bid.id });
    expect(first).toEqual({ ok: true });
    const [snap1] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    const second = await withdrawInventoryBid({ bidId: bid.id });
    expect(second).toEqual({ ok: true });
    const [snap2] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(snap2.status).toBe("withdrawn");
    expect(snap2.decidedAt?.getTime()).toBe(snap1.decidedAt?.getTime()); // unchanged on second call
  });
});

describe("rejectInventoryBid", () => {
  it("owner can reject a pending bid", async () => {
    const { bid } = await seed();
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: true });
    const [after] = await db.select().from(inventoryBids).where(eq(inventoryBids.id, bid.id));
    expect(after.status).toBe("rejected");
    expect(after.decidedAt).not.toBeNull();
  });

  it("non-owner cannot reject", async () => {
    const { bid } = await seed();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 888 });
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("cannot reject an already-decided bid", async () => {
    const { bid } = await seed();
    await db.update(inventoryBids).set({ status: "withdrawn", decidedAt: new Date() }).where(eq(inventoryBids.id, bid.id));
    const res = await rejectInventoryBid({ bidId: bid.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });
});
