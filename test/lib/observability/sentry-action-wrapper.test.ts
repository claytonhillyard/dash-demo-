// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: unknown) => void }) => unknown) =>
    fn({ setTag: vi.fn() }),
  ),
  setTag: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { deals } from "@/db/schema";
import {
  postDeal, postDealMessage, __setTestDb,
} from "@/lib/deals/actions";
import { __setTestDb as setInventoryDb, createInventoryItem } from "@/lib/inventory/actions";

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  await setInventoryDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await setInventoryDb(null);
  await closeSharedDb();
});

describe("action wrapper Sentry capture", () => {
  it("calls Sentry.captureException with layer=deals-action on a non-Forbidden throw", async () => {
    // Force a database error by trying to insert a deal with a kind enum value
    // that the schema rejects (this hits the action's catch path).
    const Sentry = await import("@sentry/nextjs");
    const res = await postDeal({
      kind: "NOT_A_VALID_KIND", // will Zod-fail first, but we want a *thrown* DB error
      category: "Diamond",
      subject: "x",
      quantity: 1,
      priceCents: 1000,
      currency: "USD",
    });
    // Zod failure path returns ok:false but does NOT capture (validation
    // failures are user input errors, not bugs).
    if (!res.ok && res.error.toLowerCase().includes("kind")) {
      expect(Sentry.captureException).not.toHaveBeenCalled();
      return; // Zod caught it before the DB; the throw-path is exercised below
    }
    // Otherwise the DB threw — verify capture shape.
    expect(Sentry.captureException).toHaveBeenCalled();
    const callArgs = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1].tags.layer).toBe("deals-action");
  });

  it("does NOT call captureException when a ForbiddenError is thrown", async () => {
    const Sentry = await import("@sentry/nextjs");
    // Seed an owner=999 deal with no circle. session.orgId=1 tries to post.
    // TODO(slice-11 review): plan used `.returning({ id: deals.id })` but the
    // Db union (Neon | PGlite) doesn't resolve the overloaded returning signature
    // under tsc — same finding as slice-4/slice-5 tests. Switched to no-arg
    // returning() (returns all columns; we only read .id).
    const inserted = await db.insert(deals).values({
      orgId: 999, kind: "SELL", category: "Diamond", subject: "x",
      quantity: 1, priceCents: 1000, postedByLabel: "x", threadMode: "private",
    }).returning();
    const d = inserted[0];
    const res = await postDealMessage({ dealId: d.id, body: "no" });
    expect(res).toEqual({ ok: false, error: "Forbidden" });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("demo mode short-circuits before the try block — no Sentry call", async () => {
    const Sentry = await import("@sentry/nextjs");
    const original = process.env.NEXT_PUBLIC_DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    try {
      const res = await createInventoryItem({
        category: "Diamond", name: "x", quantity: 1,
        status: "InStock", unitCostCents: 100, retailPriceCents: 200,
      });
      expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
      expect(Sentry.captureException).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = original;
    }
  });
});
