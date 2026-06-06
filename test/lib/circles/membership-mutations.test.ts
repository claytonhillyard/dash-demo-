// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { addOrgToCircle, removeOrgFromCircle } from "@/lib/circles/membership-mutations";
import { eq, and } from "drizzle-orm";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(): Promise<number> {
  const [c] = await db.insert(circles)
    .values({ name: "C", slug: "c", ownerOrgId: 1 })
    .returning();
  return c.id;
}

describe("addOrgToCircle (canonical writer)", () => {
  it("inserts a membership row", async () => {
    const c = await makeCircle();
    await addOrgToCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(1);
    expect(rows[0].orgId).toBe(999);
  });

  it("is idempotent: calling twice produces exactly one row (ON CONFLICT DO NOTHING)", async () => {
    const c = await makeCircle();
    await addOrgToCircle(db, c, 999);
    await addOrgToCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(and(eq(circleMembers.circleId, c), eq(circleMembers.orgId, 999)));
    expect(rows).toHaveLength(1);
  });
});

describe("removeOrgFromCircle (canonical writer)", () => {
  it("deletes a membership row", async () => {
    const c = await makeCircle();
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    await removeOrgFromCircle(db, c, 999);
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(0);
  });

  it("is idempotent: deleting a non-member is a no-op", async () => {
    const c = await makeCircle();
    await expect(removeOrgFromCircle(db, c, 999)).resolves.not.toThrow();
    const rows = await db.select().from(circleMembers).where(eq(circleMembers.circleId, c));
    expect(rows).toHaveLength(0);
  });
});
