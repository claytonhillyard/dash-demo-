// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { circles, circleMembers, deals } from "@/db/schema";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";

let db: Db;
beforeAll(async () => { db = await getSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });
afterAll(async () => { await closeSharedDb(); });

async function makeCircle(name = "Trusted", slug = "trusted"): Promise<number> {
  const [row] = await db.insert(circles)
    .values({ name, slug, ownerOrgId: 1 })
    .returning({ id: circles.id });
  return row.id;
}

async function addMember(circleId: number, orgId: number): Promise<void> {
  await db.insert(circleMembers).values({ circleId, orgId });
}

async function insertDeal(over: Partial<typeof deals.$inferInsert>): Promise<number> {
  const [row] = await db.insert(deals).values({
    orgId: 1, kind: "SELL", category: "Diamond", subject: "x",
    quantity: 1, priceCents: 100, postedByLabel: "boss",
    ...over,
  }).returning({ id: deals.id });
  return row.id;
}

describe("circle-aware visibility (getActiveDeals)", () => {
  it("(a) AIYA private deal visible to AIYA only", async () => {
    const d1 = await insertDeal({ orgId: 1, subject: "aiya-private", visibilityCircleId: null });
    await insertDeal({ orgId: 999, subject: "other-private", visibilityCircleId: null });

    expect((await getActiveDeals(db, 1)).map((r) => r.id)).toContain(d1);
    expect((await getActiveDeals(db, 999)).map((r) => r.id)).not.toContain(d1);
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(d1);
  });

  it("(b) circle-shared deal visible to every member of the circle (AIYA + 888)", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    const shared = await insertDeal({
      orgId: 1, subject: "aiya-shared", visibilityCircleId: c,
    });

    expect((await getActiveDeals(db, 1)).map((r) => r.id)).toContain(shared);
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).toContain(shared);
  });

  it("(c) circle-shared deal NOT visible to a non-member of the circle (org 999)", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);
    // 999 is deliberately NOT a member of c.

    const shared = await insertDeal({
      orgId: 1, subject: "aiya-shared", visibilityCircleId: c,
    });

    expect((await getActiveDeals(db, 999)).map((r) => r.id)).not.toContain(shared);
  });

  it("(d) zero-circles edge case — org 999 with no memberships sees exactly its own deals", async () => {
    // Regression guard: when circleIds is empty, the query must degenerate
    // to byte-identical slice-3 SQL — no OR, no inArray([]).
    const c = await makeCircle();
    await addMember(c, 1); // AIYA is in the circle.
    // 999 is in zero circles.

    await insertDeal({ orgId: 1, subject: "aiya-private", visibilityCircleId: null });
    await insertDeal({ orgId: 1, subject: "aiya-shared", visibilityCircleId: c });
    const own = await insertDeal({ orgId: 999, subject: "other-private", visibilityCircleId: null });

    const rows = await getActiveDeals(db, 999);
    expect(rows.map((r) => r.id)).toEqual([own]);
    expect(rows.map((r) => r.subject)).toEqual(["other-private"]);
  });

  it("(e) multi-circle viewer (AIYA in A and B) sees deals from BOTH circles, not just one", async () => {
    const a = await makeCircle("A", "a-slug");
    const b = await makeCircle("B", "b-slug");
    await addMember(a, 1);
    await addMember(b, 1);

    const inA = await insertDeal({ orgId: 888, subject: "in-A", visibilityCircleId: a });
    const inB = await insertDeal({ orgId: 999, subject: "in-B", visibilityCircleId: b });

    const ids = (await getActiveDeals(db, 1)).map((r) => r.id);
    expect(ids).toContain(inA);
    expect(ids).toContain(inB);
  });

  it("(f) cross-circle isolation — 888 (in A only) does NOT see deals shared into B", async () => {
    const a = await makeCircle("A", "a-slug");
    const b = await makeCircle("B", "b-slug");
    await addMember(a, 1);
    await addMember(a, 888);
    await addMember(b, 1); // 888 is NOT in B.

    await insertDeal({ orgId: 1, subject: "in-A", visibilityCircleId: a });
    const onlyInB = await insertDeal({ orgId: 1, subject: "in-B", visibilityCircleId: b });

    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(onlyInB);
  });

  it("(g) withdrawn cross-circle deal is hidden from getActiveDeals", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    const withdrawn = await insertDeal({
      orgId: 1, subject: "withdrawn", visibilityCircleId: c, status: "Withdrawn",
    });
    expect((await getActiveDeals(db, 888)).map((r) => r.id)).not.toContain(withdrawn);
  });
});

describe("circle-aware visibility (getAllDeals)", () => {
  it("widening composes with filters — kind=BUY across the OR-clause", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    await insertDeal({ orgId: 1, subject: "aiya-buy", kind: "BUY" });
    await insertDeal({ orgId: 1, subject: "aiya-sell", kind: "SELL" });
    await insertDeal({ orgId: 888, subject: "partner-buy", kind: "BUY", visibilityCircleId: c });
    await insertDeal({ orgId: 888, subject: "partner-sell-private", kind: "SELL", visibilityCircleId: null });

    const rows = await getAllDeals(db, 1, { kind: "BUY" });
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual(["aiya-buy", "partner-buy"]);
  });

  it("widening composes with filters — status=Filled across the OR-clause", async () => {
    const c = await makeCircle();
    await addMember(c, 1);
    await addMember(c, 888);

    await insertDeal({ orgId: 1, subject: "aiya-filled", status: "Filled" });
    await insertDeal({ orgId: 888, subject: "partner-filled-shared", status: "Filled", visibilityCircleId: c });
    await insertDeal({ orgId: 888, subject: "partner-filled-private", status: "Filled" });

    const rows = await getAllDeals(db, 1, { status: "Filled" });
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual(["aiya-filled", "partner-filled-shared"]);
  });

  it("empty-circles edge case for getAllDeals — bare slice-3 form", async () => {
    // 999 is in no circles. The widening must degenerate exactly.
    await insertDeal({ orgId: 1, subject: "aiya-private" });
    await insertDeal({ orgId: 999, subject: "other-private" });
    const rows = await getAllDeals(db, 999);
    expect(rows.map((r) => r.subject)).toEqual(["other-private"]);
  });
});
