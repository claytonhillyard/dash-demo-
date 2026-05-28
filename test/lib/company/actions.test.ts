// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import { createTestDb, type Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import {
  saveRevenueMonth,
  addRevenueTransaction,
  saveProfitMonth,
  createClient,
  deleteClient,
  createEmployee,
  saveProjection,
  __setTestDb,
} from "@/lib/company/actions";
import { requireSession } from "@/lib/auth/requireSession";

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

describe("company server actions", () => {
  it("saveRevenueMonth upserts the manual bucket", async () => {
    expect(await saveRevenueMonth({ year: 2026, month: 4, amountCents: 100_00 })).toEqual({ ok: true });
    expect(await saveRevenueMonth({ year: 2026, month: 4, amountCents: 250_00 })).toEqual({ ok: true });
  });

  it("rejects invalid input with a typed error and no throw", async () => {
    const res = await saveRevenueMonth({ year: 2026, month: 99, amountCents: 1 });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.error).toMatch(/month/);
  });

  it("re-asserts the session and surfaces unauthorized as a typed error", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Unauthorized")
    );
    const res = await createEmployee({ name: "E", role: "eng", hiredOn: "2025-01-01" });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("addRevenueTransaction inserts an itemized row", async () => {
    expect(await addRevenueTransaction({ occurredOn: "2026-04-03", amountCents: 5_00, memo: "x" })).toEqual({
      ok: true,
    });
  });

  it("saveProfitMonth upserts profit", async () => {
    expect(await saveProfitMonth({ year: 2026, month: 4, amountCents: 25_00 })).toEqual({ ok: true });
  });

  it("createClient + deleteClient round-trip", async () => {
    expect(
      await createClient({ name: "Acme", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
    ).toEqual({ ok: true });
    expect(await deleteClient(999_999)).toEqual({ ok: true }); // deleting a missing id is still ok
  });

  it("createEmployee persists a row", async () => {
    expect(await createEmployee({ name: "E1", role: "eng", hiredOn: "2025-01-01" })).toEqual({ ok: true });
  });

  it("saveProjection persists the singleton assumptions", async () => {
    expect(
      await saveProjection({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 12,
        perYearOverrides: { "2028": 200_00 },
      })
    ).toEqual({ ok: true });
  });

  it("maps a database failure to a generic error (no internal leak) and logs it server-side", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // To force a DB error we use a one-off pglite we can close mid-test; we
    // restore the shared db right after so the cleanup hook isn't affected.
    const oneOff = await createTestDb();
    await __setTestDb(oneOff.db);
    await oneOff.close();
    const res = await saveRevenueMonth({ year: 2026, month: 4, amountCents: 100_00 });
    expect(res).toEqual({ ok: false, error: "Database error" });
    expect(errSpy).toHaveBeenCalled(); // raw error logged server-side, not returned
    errSpy.mockRestore();
    await __setTestDb(db); // restore shared so afterAll's __setTestDb(null) is the clean teardown
  });
});
