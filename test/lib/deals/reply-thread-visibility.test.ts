// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, circles, circleMembers } from "@/db/schema";
import { postDealMessage, __setTestDb } from "@/lib/deals/actions";
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

  // Slice-10 review finding #1: this is the EXACT cell the Phase B implementer
  // caught as a security gap the original plan missed. An in-circle partner CAN
  // see a circle-scoped deal (canSeeDeal returns ok via the slice-4 visibility
  // model), but if the deal's thread_mode is 'private', ONLY the deal's owner
  // org can post — circle membership doesn't extend posting rights in private
  // mode. Without this test, the in-actions.ts private-mode gate could regress
  // silently (the existing "no-circle" case hits canSeeDeal first and never
  // reaches the private-mode check).
  it("forbids an in-circle partner from posting on a PRIVATE-mode circle-scoped deal", async () => {
    await ensureCircleWithMembers(42, "Trusted", [1, 999]);
    const dealId = await seedCircleDeal({ ownerOrgId: 1, threadMode: "private", circleId: 42 });
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await postDealMessage({ dealId, body: "should fail — private mode" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
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
