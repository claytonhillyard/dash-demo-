// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { getSharedInventoryForOrg } from "@/db/inventory";

// Demo mode must be OFF for these tests.
beforeAll(async () => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE;
  await getSharedDb();
});
afterAll(async () => { await closeSharedDb(); });
beforeEach(async () => { await resetSharedDb(); });

describe("slice 15 zero-circles regression guard", () => {
  it("returns [] for a viewer with zero memberships without issuing a SELECT", async () => {
    const db = await getSharedDb();
    // Spy on db.select to assert it's NOT called when circleIds is [].
    const spy = vi.spyOn(db, "select" as never);
    try {
      const rows = await getSharedInventoryForOrg(db, 999);
      expect(rows).toEqual([]);
      // The inventory SELECT must not be invoked.
      // (getCircleIdsForOrg DOES call select() — so we can't assert call count zero.
      // Instead, assert no .from(inventoryItems) call appears in the spy.)
      const fromCalls = spy.mock.results.flatMap((r) => {
        const builder = r.value as unknown as { _: unknown };
        // Drizzle's query builder doesn't expose .from() args at this surface;
        // a more robust assertion is: with the early return present, we never
        // BUILD a query against inventoryItems. The early-return contract is
        // checked structurally — see step 4 below.
        return builder ? [builder] : [];
      });
      // Reference to keep the linter happy; the structural test below is
      // the load-bearing guard.
      void fromCalls;
      // Soft: spy was called for the circle lookup (1 call); never twice.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("structural — the early return precedes the inventory SELECT inside getSharedInventoryForOrg", async () => {
    // Read the source file and assert the early-return line precedes the
    // inventory SELECT line inside getSharedInventoryForOrg. This is a static
    // guard against a future refactor collapsing the
    // `if (circleIds.length === 0) return []` branch.
    //
    // TODO(slice-15 review): the plan's original assertion used
    // src.indexOf(".from(inventoryItems)") to locate the inventory SELECT,
    // but getInventorySummary (defined earlier in the same file) also has
    // `.from(inventoryItems)` calls — so the FIRST match is in a function
    // that doesn't have a circleIds early return. We scope the assertion
    // to the substring starting at the `getSharedInventoryForOrg` function
    // header instead, which preserves the load-bearing guarantee: inside
    // that function, the early-return line MUST precede the inventory SELECT.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/db/inventory.ts", "utf8");
    const fnHeader = src.indexOf("export async function getSharedInventoryForOrg");
    expect(fnHeader).toBeGreaterThan(-1);
    const tail = src.slice(fnHeader);
    const earlyReturn = tail.indexOf("if (circleIds.length === 0) return [];");
    const inventorySelect = tail.indexOf(".from(inventoryItems)");
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(inventorySelect).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(inventorySelect);
  });
});
