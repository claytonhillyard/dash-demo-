// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems, inventoryBids, circles, circleMembers, orgs } from "@/db/schema";
import { postInventoryBid, __setTestDb } from "@/lib/inventory/actions";
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

async function ensureOrg(orgId: number, name: string) {
  await db.insert(orgs).values({ id: orgId, name, slug: `${name}-${orgId}` }).onConflictDoNothing();
}

async function seedItem(ownerOrgId: number, opts: {
  visibilityCircleId?: number | null;
  bidMode?: "single" | "history" | null;
} = {}) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      orgId: ownerOrgId,
      category: "Diamonds",
      name: "x",
      quantity: 1,
      status: "in_stock",
      unitCostCents: 100,
      retailPriceCents: 200,
      visibilityCircleId: opts.visibilityCircleId ?? null,
      bidMode: opts.bidMode ?? null,
    })
    .returning();
  return row.id;
}

async function ensureCircleWithMembers(name: string, slug: string, ownerOrgId: number, members: number[]) {
  const [c] = await db.insert(circles).values({ name, slug, ownerOrgId }).returning();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId: c.id, orgId }).onConflictDoNothing();
  }
  return c.id;
}

describe("postInventoryBid — authz", () => {
  it("allows an in-circle partner to bid on a circle-shared item with bidding enabled", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib1", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 12_300_00 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(inventoryBids);
    expect(rows).toHaveLength(1);
    expect(rows[0].bidderOrgId).toBe(999);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
  });

  it("forbids the item owner from bidding on their own item (self-bid block)", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib2", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when bid_mode is null (bidding disabled)", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib3", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: null });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when item is private (no visibility_circle_id)", async () => {
    const itemId = await seedItem(1, { visibilityCircleId: null, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding when the bidder is NOT in the item's circle", async () => {
    await ensureOrg(888, "stranger");
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pib4", 1, [1, 999]);
    const itemId = await seedItem(1, { visibilityCircleId: circleId, bidMode: "single" });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 888 });
    const res = await postInventoryBid({ inventoryItemId: itemId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(inventoryBids)).toHaveLength(0);
  });

  it("forbids bidding on a non-existent item id (defense against id-guessing)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "p", orgId: 999 });
    const res = await postInventoryBid({ inventoryItemId: 99999, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("rejects postInventoryBid when quantityRequested > item.quantity", async () => {
    // Item has 3 units; bidder asks for 5.
    await db.insert(circles).values({ id: 5001, name: "C", slug: "c5001", ownerOrgId: 1 }).onConflictDoNothing();
    await db.insert(circleMembers).values([
      { circleId: 5001, orgId: 1 }, { circleId: 5001, orgId: 999 },
    ]).onConflictDoNothing();
    const [item] = await db.insert(inventoryItems).values({
      orgId: 1, category: "Diamonds", name: "small-parcel", quantity: 3,
      status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
      bidMode: "history", visibilityCircleId: 5001,
    }).returning();

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

    const res = await postInventoryBid({
      inventoryItemId: item.id, priceCents: 100, quantityRequested: 5,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });

    // Zero rows inserted
    const after = await db.select().from(inventoryBids).where(eq(inventoryBids.inventoryItemId, item.id));
    expect(after).toHaveLength(0);
  });

  it("accepts postInventoryBid when quantityRequested === item.quantity (boundary)", async () => {
    await db.insert(circles).values({ id: 5002, name: "C", slug: "c5002", ownerOrgId: 1 }).onConflictDoNothing();
    await db.insert(circleMembers).values([
      { circleId: 5002, orgId: 1 }, { circleId: 5002, orgId: 999 },
    ]).onConflictDoNothing();
    const [item] = await db.insert(inventoryItems).values({
      orgId: 1, category: "Diamonds", name: "exact-match", quantity: 7,
      status: "in_stock", unitCostCents: 100, retailPriceCents: 200,
      bidMode: "history", visibilityCircleId: 5002,
    }).returning();

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: "x", orgId: 999 });

    const res = await postInventoryBid({
      inventoryItemId: item.id, priceCents: 100, quantityRequested: 7,
    });
    expect(res).toEqual({ ok: true });
  });
});
