// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "alice", orgId: 999 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, circleInvitations, activityEvents } from "@/db/schema";
import { declineInvitation, __setTestDb } from "@/lib/circles/actions";
import { and, desc, eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

// TODO(slice-4c review): plan's tests used short tokens like "tok-1" / "tok-2"
// which fail the action's Zod min(16) on tokenInput. Pad to clear the schema.
const T1 = "tok-1-AAAAAAAAAAAAAAAA";
const T2 = "tok-2-BBBBBBBBBBBBBBBB";
const T3 = "tok-3-CCCCCCCCCCCCCCCC";
const TX = "tok-exp-DDDDDDDDDDDDDDDDDD";
const NX = "no-such-token-xyz-EEEEEEE";

describe("declineInvitation", () => {
  it("happy path: status → declined, no membership row written", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: T1, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await declineInvitation({ token: T1 });
    expect(res).toEqual({ ok: true });
    const [inv] = await db.select().from(circleInvitations);
    expect(inv.status).toBe("declined");
    expect(inv.respondedAt).not.toBeNull();
    expect(await db.select().from(circleMembers)).toHaveLength(0);
    const [actRow] = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.entityType, "circle"), eq(activityEvents.verb, "deleted")))
      .orderBy(desc(activityEvents.id));
    expect(actRow).toMatchObject({
      orgId: 999,
      actor: "alice",
      entityType: "circle",
      verb: "deleted",
    });
  });

  it("wrong-slug session: Forbidden, status stays pending", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "partner",
      token: T2, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await declineInvitation({ token: T2 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [inv] = await db.select().from(circleInvitations).where(eq(circleInvitations.token, T2));
    expect(inv.status).toBe("pending");
  });

  it("already declined: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: T3, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect((await declineInvitation({ token: T3 })).ok).toBe(true);
    expect(await declineInvitation({ token: T3 })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("expired: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await db.insert(circleInvitations).values({
      circleId: c.id, fromOrgId: 1, toOrgSlug: "fixture",
      token: TX, expiresAt: new Date(Date.now() - 1000),
    });
    expect(await declineInvitation({ token: TX })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("nonexistent token: Forbidden", async () => {
    expect(await declineInvitation({ token: NX })).toEqual({ ok: false, error: "Forbidden" });
  });
});
