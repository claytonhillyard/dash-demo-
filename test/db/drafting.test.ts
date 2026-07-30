// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import { draftingPrefs } from "@/db/schema";
import { getDraftingPrefs } from "@/db/drafting";

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
