// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleInvitations, activityEvents } from "@/db/schema";
import { inviteOrgToCircle, __setTestDb } from "@/lib/circles/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { and, desc, eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

async function makeCircle(owner = 1, slug = "trusted"): Promise<number> {
  const [c] = await db.insert(circles)
    .values({ name: "Trusted", slug, ownerOrgId: owner })
    .returning();
  return c.id;
}

describe("inviteOrgToCircle", () => {
  it("owner: success → pending invite row with server-generated token + expiresAt", async () => {
    const c = await makeCircle(1);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv).toBeDefined();
    expect(inv.circleId).toBe(c);
    expect(inv.fromOrgId).toBe(1);
    expect(inv.toOrgSlug).toBe("fixture");
    expect(inv.status).toBe("pending");
    expect(inv.token.length).toBeGreaterThanOrEqual(16);
    expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(inv.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "circle"), eq(activityEvents.verb, "invited")))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toMatchObject({
      orgId: 1,
      actor: "boss",
      entityType: "circle",
      verb: "invited",
    });
  });

  it("non-owner: Forbidden (zero rows written)", async () => {
    // Circle owned by 999, session is 1.
    const c = await makeCircle(999);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("nonexistent circle: Forbidden", async () => {
    const res = await inviteOrgToCircle({ circleId: 99999, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("self-invite (slug resolves to caller's own org): no-op success", async () => {
    const c = await makeCircle(1);
    // session is org 1 (slug 'aiya' per shared-db seed)
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "aiya" });
    expect(res).toEqual({ ok: true });
    expect(await db.select().from(circleInvitations)).toHaveLength(0);
  });

  it("duplicate pending invite (same circle + slug): second insert Forbidden", async () => {
    const c = await makeCircle(1);
    const first = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(first).toEqual({ ok: true });
    const second = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(second).toEqual({ ok: false, error: "Forbidden" });
    expect(await db.select().from(circleInvitations)).toHaveLength(1);
  });

  it("re-invite allowed after a non-pending response", async () => {
    const c = await makeCircle(1);
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    // Flip the first invite to declined (simulate the recipient declining).
    await db.update(circleInvitations).set({ status: "declined" }).where(eq(circleInvitations.toOrgSlug, "fixture"));
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    expect(res).toEqual({ ok: true });
    expect(await db.select().from(circleInvitations)).toHaveLength(2);
  });

  it("wire-supplied fromOrgId is stripped (stamped from session)", async () => {
    const c = await makeCircle(1);
    const res = await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture", fromOrgId: 999 } as never);
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.fromOrgId).toBe(1);
  });

  it("token differs across two invites (uniqueness)", async () => {
    const c = await makeCircle(1);
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "fixture" });
    await inviteOrgToCircle({ circleId: c, toOrgSlug: "partner" });
    const rows = await db.select({ token: circleInvitations.token }).from(circleInvitations);
    const tokens = new Set(rows.map((r) => r.token));
    expect(tokens.size).toBe(rows.length);
  });
});
