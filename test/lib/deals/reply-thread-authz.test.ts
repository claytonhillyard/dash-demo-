// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import { setDealThreadMode, __setTestDb } from "@/lib/deals/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

async function seedOwnedDeal(orgId: number) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x",
      threadMode: "private",
    })
    .returning();
  return row.id;
}

describe("setDealThreadMode — authz", () => {
  it("allows the owner to switch private -> group", async () => {
    const dealId = await seedOwnedDeal(1);
    const res = await setDealThreadMode({ dealId, mode: "group" });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select({ mode: deals.threadMode }).from(deals).where(eq(deals.id, dealId));
    expect(row.mode).toBe("group");
  });

  it("forbids a non-owner from switching the mode", async () => {
    const dealId = await seedOwnedDeal(1);
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "partner", orgId: 999,
    });
    const res = await setDealThreadMode({ dealId, mode: "group" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    const [row] = await db.select({ mode: deals.threadMode }).from(deals).where(eq(deals.id, dealId));
    expect(row.mode).toBe("private"); // unchanged
  });
});
