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

// Mock the watcher-dispatch hook so these tests stay focused on the audit
// contract; notify.ts's own semantics are covered by
// test/lib/watchlists/notify.test.ts.
vi.mock("@/lib/watchlists/notify", () => ({
  notifyWatchersSafely: vi.fn(),
}));

import { recordActivity } from "@/lib/activity/recordActivity";
import { notifyWatchersSafely } from "@/lib/watchlists/notify";
import { recordActivitySafely } from "@/lib/activity/recordActivitySafely";

describe("recordActivitySafely", () => {
  let db: Db;
  beforeAll(async () => { db = await getSharedDb(); });
  beforeEach(async () => {
    await resetSharedDb();
    vi.mocked(recordActivity).mockReset();
    vi.mocked(notifyWatchersSafely).mockReset();
    (globalThis as Record<string, unknown>).__lastSentryError = undefined;
    (globalThis as Record<string, unknown>).__lastSentryTags = undefined;
  });
  afterAll(async () => { await closeSharedDb(); });

  it("calls recordActivity on the happy path and returns void", async () => {
    vi.mocked(recordActivity).mockResolvedValueOnce(undefined);
    vi.mocked(notifyWatchersSafely).mockResolvedValueOnce(undefined);
    const result = await recordActivitySafely(
      db,
      { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
      { action: "customers.create" },
    );
    expect(result).toBeUndefined();
    expect(recordActivity).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>).__lastSentryError).toBeUndefined();
  });

  it("calls notifyWatchersSafely once with the input after a successful recordActivity", async () => {
    vi.mocked(recordActivity).mockResolvedValueOnce(undefined);
    vi.mocked(notifyWatchersSafely).mockResolvedValueOnce(undefined);
    const input = {
      orgId: 1,
      actor: "u",
      entityType: "customer" as const,
      entityId: 1,
      verb: "created" as const,
      summary: "x",
    };
    await recordActivitySafely(db, input, { action: "customers.create" });
    expect(notifyWatchersSafely).toHaveBeenCalledOnce();
    expect(notifyWatchersSafely).toHaveBeenCalledWith(db, input);
  });

  it("still resolves void when notifyWatchersSafely rejects (existing swallow covers it)", async () => {
    vi.mocked(recordActivity).mockResolvedValueOnce(undefined);
    vi.mocked(notifyWatchersSafely).mockRejectedValueOnce(new Error("notify boom"));
    await expect(
      recordActivitySafely(
        db,
        { orgId: 1, actor: "u", entityType: "customer", entityId: 1, verb: "created", summary: "x" },
        { action: "customers.create" },
      ),
    ).resolves.toBeUndefined();
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
