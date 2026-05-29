// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name: string, slug: string, ownerOrgId = 1): Promise<number> {
  // See queries.test.ts: .returning() no-arg form to satisfy Db union under tsc.
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId })
    .returning();
  return row.id;
}

describe("isOrgMemberOfCircle", () => {
  it("returns true when the membership row exists", async () => {
    const c = await makeCircle("A", "a");
    await db.insert(circleMembers).values({ circleId: c, orgId: 1 });
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(true);
  });

  it("returns false when no membership row exists", async () => {
    const c = await makeCircle("A", "a");
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(false);
  });

  it("returns false when only the OTHER org is a member of the circle", async () => {
    const c = await makeCircle("A", "a");
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    expect(await isOrgMemberOfCircle(db, 1, c)).toBe(false);
  });

  it("returns false for a circle id that does not exist (no FK error leak)", async () => {
    expect(await isOrgMemberOfCircle(db, 1, 99999)).toBe(false);
  });
});
