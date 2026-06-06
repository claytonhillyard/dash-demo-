// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, circleInvitations } from "@/db/schema";
import {
  getCircleIdsForOrg,
  getCirclesForOrg,
  getCircleNamesForOrg,
  getOwnedCirclesForOrg,
  listCircleMemberOrgs,
  getPendingInvitesIssuedByOrg,
  getPendingInvitesForSlug,
} from "@/lib/circles/queries";
import {
  DEMO_AIYA_ORG_ID,
  DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
} from "@/lib/demo/seed";

const fiveMinFromNow = () => new Date(Date.now() + 5 * 60 * 1000);

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

describe("queries — demo mode", () => {
  // The Netlify demo never boots pglite. Each demo-mode test passes a stub
  // Db; if a guard regresses, `.select()` blows up on this object and the
  // test fails loudly rather than silently passing.
  const stubDb = {} as unknown as Db;

  it("getCircleIdsForOrg returns the seeded ids for AIYA without touching the DB", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const ids = await getCircleIdsForOrg(stubDb, DEMO_AIYA_ORG_ID);
      expect(ids).toEqual([DEMO_TRUSTED_PARTNERS_CIRCLE_ID]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("getCircleIdsForOrg returns [] for an org outside the seed graph", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const ids = await getCircleIdsForOrg(stubDb, 9999);
      expect(ids).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("getCirclesForOrg returns the seed CircleRow for AIYA without touching the DB", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const rows = await getCirclesForOrg(stubDb, DEMO_AIYA_ORG_ID);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: DEMO_TRUSTED_PARTNERS_CIRCLE_ID,
        name: "AIYA Trusted Partners",
        slug: "aiya-trusted-partners",
        ownerOrgId: DEMO_AIYA_ORG_ID,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("getCircleNamesForOrg returns a Map<id, name> built from the seed circles", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    try {
      const map = await getCircleNamesForOrg(stubDb, DEMO_AIYA_ORG_ID);
      expect(map.get(DEMO_TRUSTED_PARTNERS_CIRCLE_ID)).toBe("AIYA Trusted Partners");
      expect(map.size).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("getOwnedCirclesForOrg", () => {
  it("returns only circles owned by the caller", async () => {
    const a = await makeCircle("A", "a", 1);
    const b = await makeCircle("B", "b", 999);
    await db.insert(circleMembers).values({ circleId: b, orgId: 1 }); // 1 is a member but not owner

    const owned = await getOwnedCirclesForOrg(db, 1);
    expect(owned.map((c) => c.id)).toEqual([a]);
  });

  it("returns [] when the caller owns no circles", async () => {
    await db.insert(circles).values({ name: "A", slug: "a", ownerOrgId: 999 });
    expect(await getOwnedCirclesForOrg(db, 1)).toEqual([]);
  });
});

describe("listCircleMemberOrgs", () => {
  it("returns the joined org rows for a circle the viewer is in", async () => {
    const c = await makeCircle("C", "c", 1);
    await db.insert(circleMembers).values([
      { circleId: c, orgId: 1 },
      { circleId: c, orgId: 888 },
    ]);
    const members = await listCircleMemberOrgs(db, c, 1);
    const ids = members.map((m) => m.orgId).sort();
    expect(ids).toEqual([1, 888]);
    const aiya = members.find((m) => m.orgId === 1);
    expect(aiya?.name).toBe("AIYA Designs");
  });

  it("returns [] when the viewer is NOT a member of the circle (defense-in-depth)", async () => {
    const c = await makeCircle("C", "c", 999);
    await db.insert(circleMembers).values({ circleId: c, orgId: 999 });
    // viewer is org 1, NOT a member of c.
    expect(await listCircleMemberOrgs(db, c, 1)).toEqual([]);
  });
});

describe("getPendingInvitesIssuedByOrg", () => {
  it("returns the outbox with circleName + fromOrgName joined", async () => {
    const c = await makeCircle("Trusted", "trusted", 1);
    await db.insert(circleInvitations).values({
      circleId: c, fromOrgId: 1, toOrgSlug: "argyle-mining",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    });
    const rows = await getPendingInvitesIssuedByOrg(db, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      circleId: c,
      circleName: "Trusted",
      fromOrgId: 1,
      fromOrgName: "AIYA Designs",
      toOrgSlug: "argyle-mining",
      status: "pending",
    });
  });

  it("does NOT return non-pending invites", async () => {
    const c = await makeCircle("C", "c", 1);
    const [inv] = await db.insert(circleInvitations).values({
      circleId: c, fromOrgId: 1, toOrgSlug: "alpha",
      token: "tok-1", expiresAt: fiveMinFromNow(),
    }).returning();
    await db.update(circleInvitations).set({ status: "declined" }).where(eq(circleInvitations.id, inv.id));

    expect(await getPendingInvitesIssuedByOrg(db, 1)).toEqual([]);
  });
});

describe("getPendingInvitesForSlug", () => {
  it("returns invites addressed to the given slug, joined with circle + inviter org", async () => {
    const c = await makeCircle("Trusted", "trusted", 1);
    await db.insert(circleInvitations).values({
      circleId: c, fromOrgId: 1, toOrgSlug: "fixture",
      token: "tok-x", expiresAt: fiveMinFromNow(),
    });
    const rows = await getPendingInvitesForSlug(db, "fixture");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      circleName: "Trusted",
      fromOrgName: "AIYA Designs",
      toOrgSlug: "fixture",
      status: "pending",
    });
  });

  it("returns [] for a slug with no pending invites", async () => {
    expect(await getPendingInvitesForSlug(db, "nobody")).toEqual([]);
  });
});
