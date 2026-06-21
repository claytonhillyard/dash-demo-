// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import type { Db } from "@/db/client";

// Mock the Sentry SDK BEFORE importing the helper so vi.mock hoists correctly.
vi.mock("@sentry/nextjs", () => ({
  withScope: (fn: (scope: { setTag: (k: string, v: unknown) => void }) => void) => {
    const tags: Record<string, unknown> = {};
    fn({ setTag: (k, v) => { tags[k] = v; } });
    (globalThis as Record<string, unknown>).__lastSentryTags = tags;
  },
  captureException: (e: unknown) => {
    (globalThis as Record<string, unknown>).__lastSentryError = e;
  },
}));

// Mock recordActivity so we can force failure deterministically.
vi.mock("@/lib/activity/recordActivity", () => ({
  recordActivity: vi.fn(),
}));

import { recordActivity } from "@/lib/activity/recordActivity";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";

describe("recordActivitySafely", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => {
    await resetSharedDb();
    vi.mocked(recordActivity).mockReset();
    (globalThis as Record<string, unknown>).__lastSentryError = undefined;
    (globalThis as Record<string, unknown>).__lastSentryTags = undefined;
  });
  afterAll(async () => { await closeSharedDb(); });

  it("calls recordActivity on the happy path and returns void", async () => {
    vi.mocked(recordActivity).mockResolvedValueOnce(undefined);
    const result = await recordActivitySafely(
      db,
      { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
      { action: "customers.create" },
    );
    expect(result).toBeUndefined();
    expect(recordActivity).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>).__lastSentryError).toBeUndefined();
  });

  it("swallows errors from recordActivity (returns void, does not throw)", async () => {
    vi.mocked(recordActivity).mockRejectedValueOnce(new Error("boom"));
    await expect(
      recordActivitySafely(
        db,
        { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
        { action: "customers.create" },
      ),
    ).resolves.toBeUndefined();
  });

  it("tags Sentry with orgId, action, and subStep=recordActivity on failure", async () => {
    const err = new Error("db unavailable");
    vi.mocked(recordActivity).mockRejectedValueOnce(err);
    await recordActivitySafely(
      db,
      { orgId: 42, actor: "u", entityType: "deal", entityId: 5, verb: "bid_placed", summary: "x" },
      { action: "deals.bid" },
    );
    expect((globalThis as Record<string, unknown>).__lastSentryError).toBe(err);
    expect((globalThis as Record<string, unknown>).__lastSentryTags).toMatchObject({
      orgId: 42,
      action: "deals.bid",
      subStep: "recordActivity",
    });
  });
});
