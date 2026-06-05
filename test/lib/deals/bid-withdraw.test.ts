// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, bids } from "@/db/schema";
import { withdrawBid, __setTestDb } from "@/lib/deals/actions";
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

async function seedDealWithBid(bidderOrgId: number, initialStatus: "pending" | "accepted" = "pending") {
  const [d] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 1000, postedByLabel: "x",
  }).returning();
  const [b] = await db.insert(bids).values({
    dealId: d.id, bidderOrgId, bidderOrgLabel: "x",
    priceCents: 1, bidMode: "single", status: initialStatus,
    decidedAt: initialStatus === "accepted" ? new Date() : null,
  }).returning();
  return { dealId: d.id, bidId: b.id };
}

describe("withdrawBid", () => {
  it("allows the bidder to withdraw a pending bid", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: true });
    const [row] = await db.select({ status: bids.status, decidedAt: bids.decidedAt })
      .from(bids).where(eq(bids.id, bidId));
    expect(row.status).toBe("withdrawn");
    expect(row.decidedAt).not.toBeNull();
  });

  it("forbids withdrawing a non-pending (accepted) bid", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999, "accepted");
    expect(await withdrawBid({ bidId })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids withdrawing another org's bid", async () => {
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("is idempotent on a row already withdrawn (returns ok no-op)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: "bidder", orgId: 999,
    });
    const { bidId } = await seedDealWithBid(999);
    expect(await withdrawBid({ bidId })).toEqual({ ok: true });
    expect(await withdrawBid({ bidId })).toEqual({ ok: true });
    const [row] = await db.select({ status: bids.status }).from(bids).where(eq(bids.id, bidId));
    expect(row.status).toBe("withdrawn");
  });
});
