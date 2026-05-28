// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import {
  postDeal, markDealFilled, withdrawDeal, __setTestDb,
} from "@/lib/deals/actions";
import { getActiveDeals, getAllDeals } from "@/lib/deals/queries";
import { requireSession } from "@/lib/auth/requireSession";
import { AIYA_ORG_ID } from "@/db/org";
import { revalidatePath } from "next/cache";

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

describe("postDeal", () => {
  it("inserts a row that getActiveDeals returns", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "Round 1.02ct G/VS1", quantity: 1, priceCents: 1240000,
    });
    expect(res).toEqual({ ok: true });
    const rows = await getActiveDeals(db, AIYA_ORG_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe("Round 1.02ct G/VS1");
    expect(rows[0].postedByLabel).toBe("boss");
  });

  it("rejects invalid input with a typed error", async () => {
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "", quantity: 1, priceCents: 100,
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/subject/);
    expect(await getAllDeals(db, AIYA_ORG_ID)).toHaveLength(0);
  });

  it("surfaces unauthorized as a typed error (no insert)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await postDeal({
      kind: "SELL", category: "Diamond",
      subject: "x", quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await getAllDeals(db, AIYA_ORG_ID)).toHaveLength(0);
  });

  it("revalidates / and /deals on success", async () => {
    await postDeal({
      kind: "BUY", category: "Metal", subject: "x", quantity: 1, priceCents: 100,
    });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/");
    expect(calls).toContain("/deals");
  });
});

describe("markDealFilled", () => {
  it("flips an Open deal to Filled", async () => {
    await postDeal({
      kind: "SELL", category: "Diamond", subject: "x", quantity: 1, priceCents: 100,
    });
    const [row] = await db.select({ id: deals.id }).from(deals);
    const res = await markDealFilled(row.id);
    expect(res).toEqual({ ok: true });
    const all = await getAllDeals(db, AIYA_ORG_ID);
    expect(all[0].status).toBe("Filled");
  });
});

describe("withdrawDeal", () => {
  it("flips an Open deal to Withdrawn", async () => {
    await postDeal({
      kind: "BUY", category: "Gem", subject: "x", quantity: 1, priceCents: 100,
    });
    const [row] = await db.select({ id: deals.id }).from(deals);
    const res = await withdrawDeal(row.id);
    expect(res).toEqual({ ok: true });
    const all = await getAllDeals(db, AIYA_ORG_ID);
    expect(all[0].status).toBe("Withdrawn");
  });

  it("rejects non-integer id with a typed error", async () => {
    const res = await withdrawDeal("oops" as unknown as number);
    expect(res.ok).toBe(false);
  });
});

describe("tenancy isolation on mutation", () => {
  it("withdrawDeal does not touch other-org rows", async () => {
    await db.insert(deals).values({
      orgId: 2, kind: "SELL", category: "Diamond", subject: "other",
      quantity: 1, priceCents: 100, postedByLabel: "x",
    });
    const [otherRow] = await db.select({ id: deals.id }).from(deals);
    const res = await withdrawDeal(otherRow.id);
    expect(res).toEqual({ ok: true }); // no error, no match
    const orgTwo = await getAllDeals(db, 2);
    expect(orgTwo[0].status).toBe("Open"); // unchanged
  });
});

describe("demo writes disabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("postDeal returns the disabled error and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "x", quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });

  it("markDealFilled returns the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await markDealFilled(1)).toEqual({
      ok: false, error: "Demo mode — changes are disabled",
    });
  });

  it("withdrawDeal returns the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await withdrawDeal(1)).toEqual({
      ok: false, error: "Demo mode — changes are disabled",
    });
  });
});
