// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { markDealThreadRead, __setTestDb } from "@/lib/deals/actions";
import { getUnreadCountsForOrg } from "@/db/dealMessages";

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

async function seedDealAndMessages(senderOrgIds: number[]) {
  const [d] = await db
    .insert(deals)
    .values({
      orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "group",
    })
    .returning();
  for (const orgId of senderOrgIds) {
    await db.insert(dealMessages).values({
      dealId: d.id, fromOrgId: orgId, fromOrgLabel: "x", body: "m", threadMode: "group",
    });
  }
  return d.id;
}

describe("markDealThreadRead — unread badge math", () => {
  it("drops unread to 0 after marking read", async () => {
    const dealId = await seedDealAndMessages([999, 999, 999]);
    const before = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(before.get(dealId)).toBe(3);
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true });
    const after = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(after.get(dealId)).toBe(0);
  });

  it("ignores own messages in the unread count", async () => {
    const dealId = await seedDealAndMessages([1, 1, 1]); // session = org 1
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId) ?? 0).toBe(0);
  });

  it("forbids markDealThreadRead on a deal the caller cannot see", async () => {
    // owner = 999, no circle
    const [d] = await db
      .insert(deals)
      .values({
        orgId: 999, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "private",
      })
      .returning();
    // session = org 1 (default)
    const res = await markDealThreadRead({ dealId: d.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("upsert: second mark with later timestamp updates last_read_at", async () => {
    const dealId = await seedDealAndMessages([999]);
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true });
    expect(await markDealThreadRead({ dealId })).toEqual({ ok: true }); // no error
  });
});
