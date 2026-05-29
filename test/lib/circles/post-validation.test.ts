// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, deals } from "@/db/schema";
import { postDeal, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function makeCircle(slug: string, owner = 1): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name: slug, slug, ownerOrgId: owner })
    .returning({ id: circles.id });
  return row.id;
}

describe("postDeal — circle membership authz", () => {
  it("succeeds when the session's org is a member of the requested circle", async () => {
    const c = await makeCircle("trusted");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });

    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "shared deal",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(res).toEqual({ ok: true });

    const rows = await db.select({
      orgId: deals.orgId, visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].visibilityCircleId).toBe(c);
  });

  it("rejects with Forbidden when the session's org is NOT a member (zero rows written)", async () => {
    const c = await makeCircle("private-to-999");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    // Session is org 1 (the default mock); org 1 is NOT a member of c.

    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "attempted shared",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });

    const rows = await db.select({ id: deals.id }).from(deals);
    expect(rows).toHaveLength(0); // INSERT never ran.
  });

  it("rejects with Forbidden when the circle id does not exist (no FK error leak)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "nonexistent",
      quantity: 1, priceCents: 100, visibilityCircleId: 99999,
    });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select({ id: deals.id }).from(deals)).toHaveLength(0);
  });

  it("succeeds with null visibilityCircleId (explicit private)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "explicit private",
      quantity: 1, priceCents: 100, visibilityCircleId: null,
    });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].visibilityCircleId).toBeNull();
  });

  it("succeeds with omitted visibilityCircleId (implicit private)", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "omitted",
      quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].visibilityCircleId).toBeNull();
  });

  it("never trusts orgId from the wire — circle membership is checked against session.orgId", async () => {
    const c = await makeCircle("aiya-only");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });

    // Session is the default mock (org 1). The attacker tries to fool the
    // action into using "their" orgId (999) for the membership check by
    // including orgId in the payload. Zod strips unknown fields; the
    // membership check still runs against session.orgId = 1 (which IS a
    // member), so the post succeeds — and lands with orgId = 1, NOT 999.
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "smuggled orgId",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
      // Wire-supplied junk:
      orgId: 999,
    } as never);
    expect(res).toEqual({ ok: true });
    const rows = await db.select({
      orgId: deals.orgId, visibilityCircleId: deals.visibilityCircleId,
    }).from(deals);
    expect(rows[0].orgId).toBe(1);
    expect(rows[0].visibilityCircleId).toBe(c);
  });

  it("rejection-with-different-session — session=999 (member) succeeds, session=1 (non-member) fails", async () => {
    const c = await makeCircle("999-only");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });

    // Session as 999: success.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "alice", orgId: 999,
    });
    const ok = await postDeal({
      kind: "SELL", category: "Diamond", subject: "999 shares",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(ok).toEqual({ ok: true });

    // Session as 1: forbidden.
    const denied = await postDeal({
      kind: "SELL", category: "Diamond", subject: "1 tries to share into 999s circle",
      quantity: 1, priceCents: 100, visibilityCircleId: c,
    });
    expect(denied).toEqual({ ok: false, error: "Forbidden" });

    // Exactly one row was written (the 999 success).
    const rows = await db.select({ orgId: deals.orgId }).from(deals)
      .where(eq(deals.visibilityCircleId, c));
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(999);
  });
});
