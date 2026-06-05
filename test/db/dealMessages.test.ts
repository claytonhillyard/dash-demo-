// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { getDealMessages, getUnreadCountsForOrg } from "@/db/dealMessages";
import { dealThreadReads } from "@/db/schema";

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

async function seedDeal(orgId: number, threadMode: "private" | "group" = "private") {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "test deal",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "test",
      threadMode,
    })
    .returning({ id: deals.id });
  return row.id;
}

describe("getDealMessages — chronological order", () => {
  it("returns the viewer-visible messages ordered ascending by createdAt", async () => {
    const dealId = await seedDeal(1, "group");
    await db.insert(dealMessages).values([
      { dealId, fromOrgId: 1, fromOrgLabel: "AIYA", body: "first", threadMode: "group" },
      { dealId, fromOrgId: 999, fromOrgLabel: "Other", body: "second", threadMode: "group" },
    ]);
    const rows = await getDealMessages(db, 1, dealId);
    expect(rows.map((r) => r.body)).toEqual(["first", "second"]);
  });
});

describe("getUnreadCountsForOrg", () => {
  it("counts visible, non-own, non-deleted messages newer than last_read_at", async () => {
    const dealA = await seedDeal(1, "group");
    const dealB = await seedDeal(1, "group");

    // 3 messages from org 999 to deal A, 1 own message from 999 also on A
    await db.insert(dealMessages).values([
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a1", threadMode: "group" },
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a2", threadMode: "group" },
      { dealId: dealA, fromOrgId: 999, fromOrgLabel: "X", body: "a3", threadMode: "group" },
    ]);

    // 1 message on B
    await db.insert(dealMessages).values({
      dealId: dealB, fromOrgId: 999, fromOrgLabel: "X", body: "b1", threadMode: "group",
    });

    // Viewer = org 1 (owner of both deals), has not read any thread
    const before = await getUnreadCountsForOrg(db, 1, [dealA, dealB]);
    expect(before.get(dealA)).toBe(3);
    expect(before.get(dealB)).toBe(1);

    // Mark dealA read for org 1 (last_read_at = now())
    await db.insert(dealThreadReads).values({
      orgId: 1, dealId: dealA, lastReadAt: new Date(),
    });

    const after = await getUnreadCountsForOrg(db, 1, [dealA, dealB]);
    expect(after.get(dealA)).toBe(0);
    expect(after.get(dealB)).toBe(1);
  });

  it("excludes the viewer's own messages from the count", async () => {
    const dealId = await seedDeal(1, "group");
    await db.insert(dealMessages).values([
      { dealId, fromOrgId: 1, fromOrgLabel: "self", body: "mine", threadMode: "group" },
      { dealId, fromOrgId: 999, fromOrgLabel: "other", body: "theirs", threadMode: "group" },
    ]);
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId)).toBe(1); // only "theirs"
  });

  it("excludes soft-deleted messages from the count", async () => {
    const dealId = await seedDeal(1, "group");
    const [row] = await db
      .insert(dealMessages)
      .values({ dealId, fromOrgId: 999, fromOrgLabel: "x", body: "live", threadMode: "group" })
      .returning({ id: dealMessages.id });
    await db.insert(dealMessages).values({
      dealId, fromOrgId: 999, fromOrgLabel: "x", body: "dead", threadMode: "group",
      deletedAt: new Date(),
    });
    const counts = await getUnreadCountsForOrg(db, 1, [dealId]);
    expect(counts.get(dealId)).toBe(1); // only "live"
    expect(row.id).toBeGreaterThan(0); // sanity
  });
});
