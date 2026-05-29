// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers } from "@/db/schema";
import {
  getCircleIdsForOrg,
  getCirclesForOrg,
  getCircleNamesForOrg,
} from "@/lib/circles/queries";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name: string, slug: string, ownerOrgId = 1): Promise<number> {
  // TODO(slice-4 review): plan code used `.returning({ id: circles.id })`, but
  // the Db union (Neon | PGlite) doesn't resolve the overloaded returning
  // signature, so we use the no-arg variant which returns all columns and pull
  // .id from there. Same runtime behavior; tsc-only fix.
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId })
    .returning();
  return row.id;
}

describe("getCircleIdsForOrg", () => {
  it("returns [] for an org with no memberships", async () => {
    expect(await getCircleIdsForOrg(db, 1)).toEqual([]);
  });

  it("returns the full set of ids for an org in multiple circles", async () => {
    const a = await makeCircle("A", "a");
    const b = await makeCircle("B", "b");
    const c = await makeCircle("C", "c");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
      { circleId: b, orgId: 1 },
      { circleId: c, orgId: 999 },
    ]);
    const ids = await getCircleIdsForOrg(db, 1);
    expect(ids.sort()).toEqual([a, b].sort());
  });

  it("scopes to the requested org (org 999 sees only its own memberships)", async () => {
    const a = await makeCircle("A", "a");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
    ]);
    expect(await getCircleIdsForOrg(db, 999)).toEqual([]);
  });
});

describe("getCirclesForOrg", () => {
  it("returns joined CircleRow[] with name + slug populated", async () => {
    const a = await makeCircle("Alpha", "alpha");
    await db.insert(circleMembers).values({ circleId: a, orgId: 1 });
    const rows = await getCirclesForOrg(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a, name: "Alpha", slug: "alpha", ownerOrgId: 1 });
  });

  it("returns [] for an org with no memberships", async () => {
    expect(await getCirclesForOrg(db, 1)).toEqual([]);
  });
});

describe("getCircleNamesForOrg", () => {
  it("returns a Map<id, name> for the viewer's circles", async () => {
    const a = await makeCircle("Alpha", "alpha");
    const b = await makeCircle("Beta", "beta");
    await db.insert(circleMembers).values([
      { circleId: a, orgId: 1 },
      { circleId: b, orgId: 1 },
    ]);
    const map = await getCircleNamesForOrg(db, 1);
    expect(map.get(a)).toBe("Alpha");
    expect(map.get(b)).toBe("Beta");
    expect(map.size).toBe(2);
  });

  it("returns an empty Map for an org with no memberships", async () => {
    const map = await getCircleNamesForOrg(db, 1);
    expect(map.size).toBe(0);
  });
});
