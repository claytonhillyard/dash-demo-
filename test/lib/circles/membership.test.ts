// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import { isOrgMemberOfCircle } from "@/lib/circles/membership";
import {
  DEMO_AIYA_ORG_ID,
  DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
} from "@/lib/demo/seed";

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

describe("isOrgMemberOfCircle — demo mode", () => {
  // Sanity that we use a *stub* db: if the demo guard regresses, .select()
  // throws on this object and the test fails loudly.
  const stubDb = {} as unknown as Db;

  it("returns true for the AIYA org + Trusted Partners circle without touching the DB", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const result = await isOrgMemberOfCircle(
        stubDb,
        DEMO_AIYA_ORG_ID,
        DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      );
      expect(result).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns false for an org id not in the seed membership graph", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const result = await isOrgMemberOfCircle(
        stubDb,
        9999,
        DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
      );
      expect(result).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
