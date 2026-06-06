// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { removeOrgFromCircle, __setTestDb } from "@/lib/circles/actions";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("removeOrgFromCircle action", () => {
  it("owner removes a member: row gone", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values([{ circleId: c.id, orgId: 1 }, { circleId: c.id, orgId: 888 }]);
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c.id));
    expect(rows.map((r) => r.orgId).sort()).toEqual([1]);
  });

  it("non-owner attempts: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 888 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    // Row still present.
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 888)));
    expect(rows).toHaveLength(1);
  });

  it("cannot remove the owner: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 1 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("nonexistent circle: Forbidden", async () => {
    const res = await removeOrgFromCircle({ circleId: 99999, orgId: 888 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("idempotent: removing a non-member is ok=true with zero deleted rows", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning({ id: circles.id });
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await removeOrgFromCircle({ circleId: c.id, orgId: 888 });
    expect(res).toEqual({ ok: true });
  });
});
