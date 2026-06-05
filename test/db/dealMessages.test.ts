// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { getDealMessages } from "@/db/dealMessages";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

async function seedDeal(orgId: number, threadMode: "private" | "group" = "private") {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "test deal",
      quantity: 1,
      priceCents: 1000,
      postedByLabel: "test",
      threadMode,
    })
    .returning({ id: deals.id });
  return row.id;
}

describe("getDealMessages — chronological order", () => {
  it("returns the viewer-visible messages ordered ascending by createdAt", async () => {
    const dealId = await seedDeal(1, "group");
    await db.insert(dealMessages).values([
      { dealId, fromOrgId: 1, fromOrgLabel: "AIYA", body: "first", threadMode: "group" },
      { dealId, fromOrgId: 999, fromOrgLabel: "Other", body: "second", threadMode: "group" },
    ]);
    const rows = await getDealMessages(db, 1, dealId);
    expect(rows.map((r) => r.body)).toEqual(["first", "second"]);
  });
});
