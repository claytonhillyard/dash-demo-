// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { leaveCircle, __setTestDb } from "@/lib/circles/actions";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); await __setTestDb(db); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await __setTestDb(null); await closeSharedDb(); });

describe("leaveCircle", () => {
  it("member leaves: row gone", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning();
    await db.insert(circleMembers).values([{ circleId: c.id, orgId: 999 }, { circleId: c.id, orgId: 1 }]);
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: true });
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 1)));
    expect(rows).toHaveLength(0);
  });

  it("owner cannot leave their own circle: Forbidden", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 1 }).returning();
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 1 });
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c.id), eq(circleMembers.orgId, 1)));
    expect(rows).toHaveLength(1);
  });

  it("nonexistent circle: Forbidden", async () => {
    expect(await leaveCircle({ circleId: 99999 })).toEqual({ ok: false, error: "Forbidden" });
  });

  it("idempotent: leaving a circle the caller is not in returns ok=true", async () => {
    const [c] = await db.insert(circles).values({ name: "T", slug: "t", ownerOrgId: 999 }).returning();
    await db.insert(circleMembers).values({ circleId: c.id, orgId: 999 });
    const res = await leaveCircle({ circleId: c.id });
    expect(res).toEqual({ ok: true });
  });
});
