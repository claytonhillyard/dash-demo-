// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, circles, circleMembers, bids } from "@/db/schema";
import { postBid, __setTestDb } from "@/lib/deals/actions";
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

async function seedDeal(ownerOrgId: number, circleId: number | null = null, bidMode: "single" | "history" = "single") {
  const [row] = await db
    .insert(deals)
    .values({
      orgId: ownerOrgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      visibilityCircleId: circleId, bidMode,
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

describe("postBid — authz", () => {
  it("allows an in-circle partner to bid on a circle-scoped deal", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb1", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postBid({ dealId, priceCents: 12_300_00 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(1);
    expect(rows[0].bidderOrgId).toBe(999);
    expect(rows[0].priceCents).toBe(12_300_00);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].bidMode).toBe("single");
  });

  it("forbids an out-of-circle org from bidding", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb2", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(0);
  });

  it("forbids the deal owner from bidding on their own deal (no self-bidding)", async () => {
    const dealId = await seedDeal(1);
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(bids);
    expect(rows).toHaveLength(0);
  });

  it("forbids a non-owner from bidding on a private (no-circle) deal", async () => {
    const dealId = await seedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postBid({ dealId, priceCents: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("snapshots history-mode when deals.bid_mode is set to history at send time", async () => {
    const circleId = await ensureCircleWithMembers("Trusted", "trusted-pb5", 1, [1, 999]);
    const dealId = await seedDeal(1, circleId, "history");
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    await postBid({ dealId, priceCents: 100 });
    const [row] = await db.select().from(bids);
    expect(row.bidMode).toBe("history");
  });
});
