// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages, circles, circleMembers } from "@/db/schema";
import { postDealMessage, setDealThreadMode, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { asc, eq } from "drizzle-orm";

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

describe("Mode switch never rewrites past messages", () => {
  it("each message records the mode that was active at send time", async () => {
    // Circle so non-owner can post; otherwise the partner posts would fail authz
    await db
      .insert(circles)
      .values({ id: 7, name: "Test", slug: "test7", ownerOrgId: 1 })
      .onConflictDoNothing();
    await db.insert(circleMembers).values([
      { circleId: 7, orgId: 1 }, { circleId: 7, orgId: 999 },
    ]).onConflictDoNothing();

    const [d] = await db
      .insert(deals)
      .values({
        orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
        quantity: 1, priceCents: 1000, postedByLabel: "x",
        threadMode: "private", visibilityCircleId: 7,
      })
      .returning();

    // TODO(slice-10 review): plan's B6 test had a partner (org 999) post
    // m1-private. That collides with the user-prompt-mandated slice-10
    // private-mode authz check (only owner may post in private). Adjusted
    // to have the owner post m1-private — the test still proves the
    // mode-immutability property (each message keeps its snapshot through
    // toggles) which is what B6 is verifying.
    // 1) Owner posts while mode = private  -> snapshot "private"
    await postDealMessage({ dealId: d.id, body: "m1-private" });

    // 2) Owner flips to group
    await setDealThreadMode({ dealId: d.id, mode: "group" });

    // 3) Partner posts -> snapshot "group"
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "p", orgId: 999,
    });
    await postDealMessage({ dealId: d.id, body: "m2-group" });

    // 4) Owner flips back to private
    await setDealThreadMode({ dealId: d.id, mode: "private" });

    // 5) Owner posts -> snapshot "private"
    await postDealMessage({ dealId: d.id, body: "m3-private" });

    const rows = await db
      .select({ body: dealMessages.body, mode: dealMessages.threadMode })
      .from(dealMessages)
      .where(eq(dealMessages.dealId, d.id))
      .orderBy(asc(dealMessages.createdAt));
    expect(rows).toEqual([
      { body: "m1-private", mode: "private" },
      { body: "m2-group", mode: "group" },
      { body: "m3-private", mode: "private" },
    ]);
  });
});
