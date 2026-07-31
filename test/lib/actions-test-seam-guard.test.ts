// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
// getDb is swapped for a call-counting stand-in (not the real pglite-booting
// implementation), so this file stays a fast, hermetic check of the
// __setTestDb guard itself -- getDb()'s own correctness is test/db/client.test.ts's
// job. The counter lives on globalThis, not a module-scope const, because
// vi.mock factories are hoisted above regular declarations -- same escape
// hatch test/app/circles-page.test.tsx uses for mocking @/db/client.
vi.mock("@/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/db/client")>("@/db/client");
  return {
    ...actual,
    getDb: () => {
      const g = globalThis as { __c7GetDbCalls?: number; __c7FakeDb?: unknown };
      g.__c7GetDbCalls = (g.__c7GetDbCalls ?? 0) + 1;
      return g.__c7FakeDb;
    },
  };
});

import type { Db } from "@/db/client";
import { recordPayment, __setTestDb } from "@/lib/payments/actions";

/** Bare-minimum fake satisfying recordPayment's first read --
 *  `select().from().where().limit(1)` resolving to `[]` -- so the action
 *  deterministically takes its "invoice not found" branch (Forbidden)
 *  instead of crashing, letting the test tell "real getDb() path used" and
 *  "sentinel object used" apart by their distinct, legitimate outcomes. */
function emptyFakeDb(): Db {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [],
  };
  return chain as unknown as Db;
}

const validInput = {
  invoiceId: 1,
  amountCents: 100,
  method: "cash" as const,
  receivedDate: "2020-01-01",
};

function resetGetDbTracking(fakeDb: unknown): void {
  const g = globalThis as { __c7GetDbCalls?: number; __c7FakeDb?: unknown };
  g.__c7GetDbCalls = 0;
  g.__c7FakeDb = fakeDb;
}
function getDbCallCount(): number {
  return (globalThis as { __c7GetDbCalls?: number }).__c7GetDbCalls ?? 0;
}

// Representative module only (payments/actions.ts) -- all 14 "use server"
// action files share the identical `if (...) return; testDb = d;` guard
// shape, verified file-by-file via the C-7 plan's grep pass instead of a
// test per module.
describe("__setTestDb production no-op guard (C-7)", () => {
  afterEach(async () => {
    // Restore the ambient (real) test env FIRST: a cleanup call made while
    // still prod-stubbed would itself be a guarded no-op and leave testDb
    // dirty for the next test.
    vi.unstubAllEnvs();
    await __setTestDb(null);
  });

  it("ignores a sentinel db set outside the test environment, and recovers cleanly once back in it", async () => {
    resetGetDbTracking(emptyFakeDb());
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");

    // A sentinel with none of Db's query-builder surface: if the guard
    // failed to no-op this call, the very next action's `db()` would return
    // THIS object instead of falling through to getDb(), and its `.select`
    // call would throw a TypeError -- observably different from Forbidden.
    await __setTestDb({ SENTINEL: true } as unknown as Db);

    const poisoned = await recordPayment(validInput);

    // `testDb ?? getDb()` only reaches getDb() when testDb is still null --
    // i.e. the prod-env __setTestDb call above never took effect.
    expect(getDbCallCount()).toBe(1);
    expect(poisoned).toEqual({ ok: false, error: "Forbidden" });

    // No persistent corruption: restoring the real test env lets a
    // legitimate __setTestDb call take effect normally afterward.
    vi.unstubAllEnvs();
    resetGetDbTracking(emptyFakeDb());
    await __setTestDb(emptyFakeDb());

    const recovered = await recordPayment(validInput);

    // testDb is set for real this time, so db() short-circuits before ever
    // calling getDb().
    expect(getDbCallCount()).toBe(0);
    expect(recovered).toEqual({ ok: false, error: "Forbidden" });
  });
});
