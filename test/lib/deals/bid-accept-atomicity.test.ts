// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, bids, orgs } from "@/db/schema";
import { acceptBid, __setTestDb } from "@/lib/deals/actions";
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

describe("acceptBid — atomicity", () => {
  it("fills the deal, accepts the chosen bid, and auto-rejects siblings in one txn", async () => {
    // Add a 3rd partner org (501) so we can seed 3 sibling bids.
    await db.insert(orgs).values({ id: 501, name: "Partner P", slug: "partner-p" }).onConflictDoNothing();
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();
    const [b1, b2, b3] = await db.insert(bids).values([
      { dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1200, bidMode: "single" },
      { dealId: d.id, bidderOrgId: 888, bidderOrgLabel: "S", priceCents: 1100, bidMode: "single" },
      { dealId: d.id, bidderOrgId: 501, bidderOrgLabel: "P", priceCents: 1300, bidMode: "single" },
    ]).returning();

    const res = await acceptBid({ bidId: b1.id });
    expect(res).toEqual({ ok: true });

    const [dealAfter] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, d.id));
    expect(dealAfter.status).toBe("Filled");

    const rows = await db.select().from(bids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(b1.id)?.status).toBe("accepted");
    expect(byId.get(b1.id)?.decidedAt).not.toBeNull();
    expect(byId.get(b2.id)?.status).toBe("auto_rejected");
    expect(byId.get(b2.id)?.decidedAt).not.toBeNull();
    expect(byId.get(b3.id)?.status).toBe("auto_rejected");
    expect(byId.get(b3.id)?.decidedAt).not.toBeNull();
  });

  it("forbids a non-owner from accepting a bid", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
    }).returning();
    const [b] = await db.insert(bids).values({
      dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1, bidMode: "single",
    }).returning();
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await acceptBid({ bidId: b.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [dealAfter] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, d.id));
    expect(dealAfter.status).toBe("Open");
  });

  it("forbids accepting a bid on a deal that is already Filled", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", status: "Filled",
    }).returning();
    const [b] = await db.insert(bids).values({
      dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "M", priceCents: 1, bidMode: "single",
    }).returning();
    const res = await acceptBid({ bidId: b.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  // Slice-16 backport of slice-18 spec §9.3: two acceptBid calls racing on
  // different bids of the same deal — exactly one wins; the other returns
  // Forbidden. Protection is the parent-row SELECT FOR UPDATE inside the tx
  // plus the post-lock status re-read. Without the lock, both txs' snapshots
  // see both bids as 'pending' under PG Read Committed and both UPDATEs
  // commit → double-accept.
  it("two concurrent accepts on the same deal — exactly one wins", async () => {
    const [d] = await db.insert(deals).values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "race-deal",
      quantity: 1, priceCents: 1000, postedByLabel: "x", bidMode: "single",
    }).returning();
    const [bidA, bidB] = await db.insert(bids).values([
      { dealId: d.id, bidderOrgId: 999, bidderOrgLabel: "A", priceCents: 1100, bidMode: "single" },
      { dealId: d.id, bidderOrgId: 888, bidderOrgLabel: "B", priceCents: 1200, bidMode: "single" },
    ]).returning();

    const [resA, resB] = await Promise.all([
      acceptBid({ bidId: bidA.id }),
      acceptBid({ bidId: bidB.id }),
    ]);

    const oks = [resA, resB].filter((r) => r.ok === true);
    const fails = [resA, resB].filter((r) => r.ok === false);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toEqual({ ok: false, error: "Forbidden" });

    const after = await db.select().from(bids).where(eq(bids.dealId, d.id));
    expect(after.filter((b) => b.status === "accepted")).toHaveLength(1);
    expect(after.filter((b) => b.status === "auto_rejected")).toHaveLength(1);

    const [dealAfter] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, d.id));
    expect(dealAfter.status).toBe("Filled");
  });
});
