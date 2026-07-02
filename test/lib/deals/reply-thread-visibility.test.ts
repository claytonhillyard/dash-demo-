// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, circles, circleMembers, dealMessages, activityEvents } from "@/db/schema";
import { postDealMessage, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { and, desc, eq } from "drizzle-orm";

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

async function seedCircleDeal(opts: {
  ownerOrgId: number;
  threadMode: "private" | "group";
  circleId: number | null;
}) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId: opts.ownerOrgId,
      kind: "SELL",
      category: "Diamond",
      subject: "vis test",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "owner",
      threadMode: opts.threadMode,
      visibilityCircleId: opts.circleId,
    })
    .returning();
  return row.id;
}

async function ensureCircleWithMembers(circleId: number, name: string, members: number[]) {
  await db
    .insert(circles)
    .values({ id: circleId, name, slug: `c${circleId}`, ownerOrgId: members[0] ?? 1 })
    .onConflictDoNothing();
  for (const orgId of members) {
    await db.insert(circleMembers).values({ circleId, orgId }).onConflictDoNothing();
  }
}

describe("postDealMessage — cross-circle visibility", () => {
  it("allows the deal owner to post on their own deal", async () => {
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: null });
    const res = await postDealMessage({ dealId, body: "owner post" });
    expect(res).toEqual({ ok: true });
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "deal"), eq(activityEvents.verb, "commented")))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toMatchObject({
      orgId: 1,
      actor: "boss",
      entityType: "deal",
      verb: "commented",
    });
  });

  it("allows an in-circle partner to post on a circle-scoped deal", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "partner post" });
    expect(res).toEqual({ ok: true });
  });

  it("forbids an out-of-circle org from posting on a circle-scoped deal", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "stranger", orgId: 888,
    });
    const res = await postDealMessage({ dealId, body: "should fail" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("forbids ANY non-owner from posting on a private (no-circle) deal", async () => {
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: null });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "no" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  // Per spec §4: private mode = each interested partner has a 1-to-1 thread
  // WITH the deal owner. An in-circle partner CAN post; the message gets
  // snapshotted as `private`, and the read-side SQL visibility predicate
  // (test/db/dealMessages.test.ts owns that coverage) restricts the row to
  // {owner, sender}. This test guards against a regression that would gate
  // posting on owner-equality (a previous review introduced exactly that
  // gate; it broke the partner-DM-owner feature and was reverted).
  it("allows an in-circle partner to post on a PRIVATE-mode circle-scoped deal (1-to-1 partner ↔ owner DM)", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "DM to owner only" });
    expect(res).toEqual({ ok: true });
    // Snapshot is "private" — the inserted row carries the mode that was
    // active at send time, so the read-side visibility filter will only
    // surface this message to the deal owner and to org 999 itself.
    const rows = await db.select().from(dealMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0].threadMode).toBe("private");
    expect(rows[0].fromOrgId).toBe(999);
  });

  it("snapshots the current deals.thread_mode onto the inserted row", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "group", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    await postDealMessage({ dealId, body: "snapshot test" });
    const { dealMessages } = await import("@/db/schema");
    const rows = await db.select().from(dealMessages);
    expect(rows).toHaveLength(1);
    expect(rows[0].threadMode).toBe("group");
  });
});
