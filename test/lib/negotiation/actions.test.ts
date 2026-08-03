// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "owner", orgId: 1 })),
}));

// Mock the Sentry SDK BEFORE importing the action, same
// mocked-Sentry-to-globalThis technique as test/lib/documents/actions.test.ts
// and test/lib/command/actions.test.ts.
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown, options?: { tags?: Record<string, unknown>; extra?: unknown }) => {
    (globalThis as Record<string, unknown>).__negSentryError = e;
    (globalThis as Record<string, unknown>).__negSentryTags = options?.tags;
    (globalThis as Record<string, unknown>).__negSentryExtra = options?.extra;
  },
  withScope: (fn: (scope: { setTag: () => void }) => void) => fn({ setTag: () => {} }),
}));

// Factory default: the seam reports simulated, so generateCoaching uses the
// local simulatedCoaching template — same rationale as
// test/lib/drafting/actions.test.ts's identical generateAiText mock (the
// mock exists so the authz tests below can assert ZERO seam invocations,
// review F6 lineage).
vi.mock("@/lib/ai/generateAiText", () => ({
  generateAiText: vi.fn(async () => ({
    ok: true as const,
    text: "[simulated] coaching",
    model: "simulated",
    simulated: true,
    durationMs: 1,
  })),
}));

// Partial mock: every export of the db layer passes through to the REAL
// implementation except getPartnerBidHistory, wrapped in a vi.fn so exactly
// one test (the Sentry-marker test below) can force an unexpected rejection
// out of the try block — same "wrap one function, everything else stays
// real" technique as test/lib/command/actions.test.ts's
// `COMMANDS.runway.run` mock (real executors never throw in practice, so
// simulating one is the only way to exercise the generic catch branch).
vi.mock("@/db/negotiation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/negotiation")>();
  return { ...actual, getPartnerBidHistory: vi.fn(actual.getPartnerBidHistory) };
});

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals, bids, activityEvents } from "@/db/schema";
import { getNegotiationCoaching, __setTestDb } from "@/lib/negotiation/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { generateAiText } from "@/lib/ai/generateAiText";
import { getPartnerBidHistory } from "@/db/negotiation";
import { DEMO_AIYA_ORG_ID, DEMO_PARTNER_ORG_IDS } from "@/lib/demo/seed";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await __setTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// Fixtures — local to this file, same rationale as
// test/lib/drafting/actions.test.ts (not shared across sibling actions test
// files, so this stays independent of that module's own mock surface).
// ---------------------------------------------------------------------------

async function seedDeal(orgId: number, overrides: Partial<typeof deals.$inferInsert> = {}) {
  const [row] = await db
    .insert(deals)
    .values({
      orgId,
      kind: "SELL",
      category: "Diamond",
      subject: "coaching-test deal",
      quantity: 1,
      priceCents: 1_000_000,
      postedByLabel: "owner",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedBid(
  dealId: number,
  bidderOrgId: number,
  overrides: Partial<typeof bids.$inferInsert> = {},
) {
  const [row] = await db
    .insert(bids)
    .values({
      dealId,
      bidderOrgId,
      bidderOrgLabel: "Fixture Co",
      priceCents: 900_000,
      bidMode: "single",
      ...overrides,
    })
    .returning();
  return row!;
}

/** Queues exactly one custom session for the NEXT requireSession() call;
 *  every call after that falls back to the module mock's default
 *  ({user:"owner", orgId:1}) — same one-shot override idiom as
 *  test/lib/drafting/actions.test.ts's mockRejectedValueOnce usage. */
function asSession(orgId: number, user = "session-user") {
  vi.mocked(requireSession).mockResolvedValueOnce({ user, orgId });
}

// A close: an opening bid (rejected) followed by an accepted re-bid, both
// decided — the minimal shape computeNegotiationStats needs to count a
// "close" (see src/lib/negotiation/compute.ts). Two of these on two
// different prior deals is exactly MIN_CLOSES_FOR_COACHING.
async function seedClose(
  ownerOrgId: number,
  bidderOrgId: number,
  opts: { firstCents: number; acceptedCents: number; dayOffset: number },
) {
  const priorDeal = await seedDeal(ownerOrgId, { priceCents: opts.acceptedCents });
  const day = (n: number) => new Date(`2026-0${opts.dayOffset}-0${n}T00:00:00Z`);
  await seedBid(priorDeal.id, bidderOrgId, {
    priceCents: opts.firstCents,
    status: "rejected",
    createdAt: day(1),
    decidedAt: day(2),
  });
  await seedBid(priorDeal.id, bidderOrgId, {
    priceCents: opts.acceptedCents,
    status: "accepted",
    createdAt: day(3),
    decidedAt: day(4),
  });
  return priorDeal.id;
}

describe("getNegotiationCoaching — happy path", () => {
  it("returns a coached verdict for the owner, sourcing the partner label from their pending bid", async () => {
    const deal = await seedDeal(1, { priceCents: 1_000_000 });
    await seedClose(1, 999, { firstCents: 800_000, acceptedCents: 850_000, dayOffset: 1 });
    await seedClose(1, 999, { firstCents: 400_000, acceptedCents: 420_000, dayOffset: 2 });
    await seedBid(deal.id, 999, { priceCents: 900_000, status: "pending", bidderOrgLabel: "Fixture Co" });

    const res = await getNegotiationCoaching({ dealId: deal.id, bidderOrgId: 999 });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stats.kind).toBe("coached");
      expect(res.stats.partnerLabel).toBe("Fixture Co");
      expect(res.lines.length).toBeGreaterThan(0);
      expect(res.simulated).toBe(true); // generateAiText mock always reports simulated
    }
  });

  it("writes no audit row and never revalidates — this is a read, not a write", async () => {
    const deal = await seedDeal(1);
    await seedBid(deal.id, 999, { priceCents: 900_000, status: "pending" });

    await getNegotiationCoaching({ dealId: deal.id, bidderOrgId: 999 });

    expect(await db.select().from(activityEvents)).toHaveLength(0);
  });
});

describe("getNegotiationCoaching — owner-only authz (the security core)", () => {
  it("forbids a caller whose session org is the BIDDER org, with ZERO seam or history-read invocations", async () => {
    const deal = await seedDeal(1);
    await seedBid(deal.id, 999, { priceCents: 900_000, status: "pending" });
    asSession(999); // the bidder itself, never the owner

    const res = await getNegotiationCoaching({ dealId: deal.id, bidderOrgId: 999 });

    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(generateAiText).not.toHaveBeenCalled();
    expect(getPartnerBidHistory).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__negSentryError).toBeUndefined();
  });

  it("forbids a cross-org dealId (owned by a different org than the caller's session)", async () => {
    const foreignDeal = await seedDeal(999); // owned by a different org than the default session (1)

    const res = await getNegotiationCoaching({ dealId: foreignDeal.id, bidderOrgId: 888 });

    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(generateAiText).not.toHaveBeenCalled();
    expect(getPartnerBidHistory).not.toHaveBeenCalled();
  });

  it("forbids a missing dealId — collapses into the SAME Forbidden as a cross-org id", async () => {
    const res = await getNegotiationCoaching({ dealId: 9_999_999, bidderOrgId: 999 });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(generateAiText).not.toHaveBeenCalled();
  });

  it("returns Unauthorized with no session, calling neither the db nor the seam", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await getNegotiationCoaching({ dealId: 1, bidderOrgId: 999 });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(generateAiText).not.toHaveBeenCalled();
  });
});

describe("getNegotiationCoaching — validation", () => {
  it("rejects a non-positive dealId before touching authz", async () => {
    const res = await getNegotiationCoaching({ dealId: 0, bidderOrgId: 999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toBe("Forbidden");
    expect(generateAiText).not.toHaveBeenCalled();
  });

  it("rejects a non-positive bidderOrgId", async () => {
    const res = await getNegotiationCoaching({ dealId: 1, bidderOrgId: -1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).not.toBe("Forbidden");
  });
});

describe("getNegotiationCoaching — insufficient history", () => {
  it("returns ok:true with the honest insufficient_history kind when this partner has under 2 closes", async () => {
    const deal = await seedDeal(1);
    // Bidder 888 has never negotiated with this owner before.
    const res = await getNegotiationCoaching({ dealId: deal.id, bidderOrgId: 888 });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stats.kind).toBe("insufficient_history");
    }
  });
});

describe("getNegotiationCoaching — demo mode (the demo-guard deviation)", () => {
  it("returns a coached verdict from the authored Mehta/AIYA history for the owner", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    asSession(DEMO_AIYA_ORG_ID);

    const res = await getNegotiationCoaching({ dealId: 109, bidderOrgId: DEMO_PARTNER_ORG_IDS.MEHTA });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.stats.kind).toBe("coached");
      expect(res.stats.partnerLabel).toBe("Mehta Diamonds");
      expect(res.lines.length).toBeGreaterThan(0);
    }
  });

  it("still enforces owner-only authz in demo mode — a bidder-org session is Forbidden", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    asSession(DEMO_PARTNER_ORG_IDS.MEHTA); // the demo partner, not AIYA

    const res = await getNegotiationCoaching({ dealId: 109, bidderOrgId: DEMO_PARTNER_ORG_IDS.MEHTA });

    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(generateAiText).not.toHaveBeenCalled();
  });
});

describe("getNegotiationCoaching — unexpected error handling", () => {
  it("Sentry-captures an executor throw with tags only — no stats/labels reach the capture", async () => {
    const deal = await seedDeal(1);
    await seedBid(deal.id, 999, {
      priceCents: 900_000,
      status: "pending",
      bidderOrgLabel: "Secret Partner Co",
    });
    vi.mocked(getPartnerBidHistory).mockRejectedValueOnce(new Error("simulated unexpected db failure"));

    const res = await getNegotiationCoaching({ dealId: deal.id, bidderOrgId: 999 });

    expect(res).toEqual({ ok: false, error: "Server error" });

    const captured = (globalThis as Record<string, unknown>).__negSentryError;
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).not.toContain("Secret Partner Co");

    const tags = (globalThis as Record<string, unknown>).__negSentryTags;
    expect(tags).toEqual({ layer: "negotiation-action", action: "getNegotiationCoaching" });

    const extra = (globalThis as Record<string, unknown>).__negSentryExtra;
    const serialized = JSON.stringify({ tags, extra });
    expect(serialized).not.toContain("Secret Partner Co");
    expect(serialized).not.toContain("stats");
    expect(serialized).not.toContain("partnerLabel");
  });
});
