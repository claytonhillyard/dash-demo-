// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, dealMessages } from "@/db/schema";
import { deleteDealMessage, __setTestDb } from "@/lib/deals/actions";
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

async function seedDealWithMessage(opts: {
  ownerOrgId: number;
  senderOrgId: number;
  createdAt: Date;
}) {
  const [d] = await db
    .insert(deals)
    .values({
      orgId: opts.ownerOrgId, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "group",
    })
    .returning();
  const [m] = await db
    .insert(dealMessages)
    .values({
      dealId: d.id, fromOrgId: opts.senderOrgId, fromOrgLabel: "x",
      body: "hello", threadMode: "group", createdAt: opts.createdAt,
    })
    .returning();
  return { dealId: d.id, messageId: m.id };
}

describe("deleteDealMessage — author + window", () => {
  it("allows the author to delete within 14 min", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1,
      createdAt: new Date(Date.now() - 14 * 60 * 1000),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
    const [row] = await db
      .select({ deletedAt: dealMessages.deletedAt })
      .from(dealMessages)
      .where(eq(dealMessages.id, messageId));
    expect(row.deletedAt).not.toBeNull();
  });

  it("forbids deletion after 16 min", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1,
      createdAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: false, error: "Forbidden" });
    const [row] = await db
      .select({ deletedAt: dealMessages.deletedAt })
      .from(dealMessages)
      .where(eq(dealMessages.id, messageId));
    expect(row.deletedAt).toBeNull(); // unchanged
  });

  it("forbids a non-author from deleting", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 1, senderOrgId: 999, createdAt: new Date(),
    });
    // session = org 1 (deal owner, but NOT the author)
    const res = await deleteDealMessage({ messageId });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
  });

  it("double-delete is idempotent (returns ok)", async () => {
    const { messageId } = await seedDealWithMessage({
      ownerOrgId: 999, senderOrgId: 1, createdAt: new Date(),
    });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
    expect(await deleteDealMessage({ messageId })).toEqual({ ok: true });
  });
});
