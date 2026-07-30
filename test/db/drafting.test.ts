// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { draftingPrefs, customers } from "@/db/schema";
import { getDraftingPrefs, getCustomerStyleNote } from "@/db/drafting";

let db: Db;

beforeAll(async () => {
  db = await getSharedDb();
});
beforeEach(async () => {
  await resetSharedDb();
});
afterAll(async () => {
  await closeSharedDb();
});

describe("getDraftingPrefs", () => {
  it("returns null when the org has never saved prefs", async () => {
    expect(await getDraftingPrefs(db, 1)).toBeNull();
  });

  it("returns the saved tone/signature when a row exists", async () => {
    await db.insert(draftingPrefs).values({
      orgId: 1,
      tone: "Warm but concise",
      signature: "— Clayton, AIYA Designs",
    });
    expect(await getDraftingPrefs(db, 1)).toEqual({
      tone: "Warm but concise",
      signature: "— Clayton, AIYA Designs",
    });
  });

  it("is org-scoped — another org's saved prefs never leak", async () => {
    await db.insert(draftingPrefs).values({
      orgId: 999,
      tone: "Terse",
      signature: "-Fixture Org",
    });
    expect(await getDraftingPrefs(db, 1)).toBeNull();
  });
});

describe("getDraftingPrefs — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the fixed demo voice constants regardless of any saved row", async () => {
    // Insert a real row first — the demo branch must short-circuit BEFORE
    // reading the table, ignoring whatever (if anything) is actually saved.
    await db.insert(draftingPrefs).values({
      orgId: 1,
      tone: "This real row must never be returned in demo mode",
      signature: "Real signature",
    });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    expect(await getDraftingPrefs(db, 1)).toEqual({
      tone: "Warm, concise, plain language",
      signature: "— AIYA Designs",
    });
  });
});

// getCustomerStyleNote (slice 37-3) — the customer edit page's targeted
// reader for one field, kept off `CustomerView` on purpose (see the doc
// comment on the function itself, src/db/drafting.ts, for the ripple this
// avoided). Same seedRow-helper convention as test/db/customers.test.ts.
async function seedCustomer(
  orgId: number,
  name: string,
  extras: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await db
    .insert(customers)
    .values({ orgId, name, ...extras })
    .returning();
  return row!.id;
}

describe("getCustomerStyleNote", () => {
  it("returns null when the customer has no style note saved", async () => {
    const id = await seedCustomer(1, "Alice");
    expect(await getCustomerStyleNote(db, 1, id)).toBeNull();
  });

  it("returns the saved style note when one exists", async () => {
    const id = await seedCustomer(1, "Alice", { styleNote: "Prefers concise, no small talk" });
    expect(await getCustomerStyleNote(db, 1, id)).toBe("Prefers concise, no small talk");
  });

  it("returns null when the customer belongs to a different org", async () => {
    const id = await seedCustomer(999, "Hidden", { styleNote: "Should never leak" });
    expect(await getCustomerStyleNote(db, 1, id)).toBeNull();
  });

  it("returns null for an unknown customer id", async () => {
    expect(await getCustomerStyleNote(db, 1, 9_999_999)).toBeNull();
  });
});

describe("getCustomerStyleNote — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("always returns null, ignoring any saved row", async () => {
    // Insert a real row first — the demo branch must short-circuit BEFORE
    // reading the table, same discipline as getDraftingPrefs's demo test
    // above, even though the "fixed" demo behavior here is null rather than
    // a canned constant (DEMO_CUSTOMERS carries no style notes, spec §4).
    const id = await seedCustomer(1, "Alice", {
      styleNote: "This real row must never be returned in demo mode",
    });
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    expect(await getCustomerStyleNote(db, 1, id)).toBeNull();
  });
});
