// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { readFileSync } from "node:fs";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import {
  getSharedDb,
  resetSharedDb,
  closeSharedDb,
} from "../../../helpers/shared-db";
import { customers, activityEvents } from "@/db/schema";
import {
  previewImport,
  commitImport,
  __setTestDb,
} from "@/lib/customers/import/actions";
import {
  createCustomer,
  __setTestDb as __setCustomersTestDb,
} from "@/lib/customers/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

// Contract: spec §5 (docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md).
// Fixture row intents (authored in 26-2, test/fixtures/winjewel-customers.csv):
// rows 1-5,10-12 mapRow-valid; row 6 bad email; row 7 bad date; row 8 is a
// duplicate of row 1's external_ref WJ-1001 (last-in-file wins, row 1
// flagged/skipped); row 9 missing name. -> 9 mapRow-valid rows, 8 unique
// refs after dedup, 3 invalid, 1 in-file-duplicate-skip. totalRows = 12.

const FIXTURE_PATH = "test/fixtures/winjewel-customers.csv";
const fixtureCsv = readFileSync(FIXTURE_PATH, "utf8");

/** Minimal synthetic CSV (Customer ID + Name only) for cap/chunk/sample tests
 * that don't need the fixture's rich validation scenarios. */
function genMinimalCsv(count: number): string {
  const header = "Customer ID,Name";
  const lines = Array.from(
    { length: count },
    (_, i) => `WJ-GEN-${i},Generated ${i}`,
  );
  return [header, ...lines].join("\n");
}

let db: Db;
beforeAll(async () => {
  db = await getSharedDb();
  await __setTestDb(db);
  await __setCustomersTestDb(db);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetSharedDb();
});
afterAll(async () => {
  await __setTestDb(null);
  await __setCustomersTestDb(null);
  await closeSharedDb();
});

// ---------------------------------------------------------------------------
// previewImport
// ---------------------------------------------------------------------------

describe("previewImport — fixture on an empty org", () => {
  it("computes totalRows/validCount/invalidCount and wouldCreate/wouldUpdate", async () => {
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalRows).toBe(12);
    expect(res.validCount).toBe(8);
    expect(res.invalidCount).toBe(3);
    expect(res.wouldCreate).toBe(8);
    expect(res.wouldUpdate).toBe(0);
  });

  it("flags row 1 (superseded WJ-1001) as not-ok with a duplicate error, in the sample", async () => {
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row1 = res.sample.find((r) => r.rowIndex === 1);
    expect(row1).toBeDefined();
    expect(row1?.ok).toBe(false);
    expect(row1?.errors?.[0]).toMatch(/duplicate/i);
    expect(row1?.errors?.[0]).toMatch(/WJ-1001/);
  });

  it("row 8 (the winner for WJ-1001) is ok:true with its own name/externalRef in the sample", async () => {
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row8 = res.sample.find((r) => r.rowIndex === 8);
    expect(row8).toMatchObject({
      ok: true,
      externalRef: "WJ-1001",
      name: "Priya Sharma-Patel",
    });
  });

  it("sample includes all 12 rows (fixture is under the 20-row sample cap)", async () => {
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sample.length).toBe(12);
    expect(res.sample.map((r) => r.rowIndex)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("does not write anything to the db", async () => {
    await previewImport({ csvText: fixtureCsv });
    expect(await db.select().from(customers)).toHaveLength(0);
    expect(await db.select().from(activityEvents)).toHaveLength(0);
  });

  it("does not revalidate any path (read-only)", async () => {
    await previewImport({ csvText: fixtureCsv });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("previewImport — wouldCreate/wouldUpdate split with a pre-seeded customer", () => {
  it("wouldUpdate reflects a pre-existing external_ref (WJ-1003)", async () => {
    await db
      .insert(customers)
      .values({ orgId: 1, name: "Existing Fatima", externalRef: "WJ-1003" });
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wouldCreate).toBe(7);
    expect(res.wouldUpdate).toBe(1);
  });
});

describe("previewImport — sample is capped at the first 20 rows", () => {
  it("a 25-row file only samples rows 1-20", async () => {
    const res = await previewImport({ csvText: genMinimalCsv(25) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalRows).toBe(25);
    expect(res.validCount).toBe(25);
    expect(res.sample.length).toBe(20);
    expect(res.sample.every((r) => r.rowIndex <= 20)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// commitImport — happy path
// ---------------------------------------------------------------------------

describe("commitImport — fixture on an empty org", () => {
  it("creates 8, updates 0, skips 4 (3 invalid + 1 in-file duplicate)", async () => {
    const res = await commitImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: true, created: 8, updated: 0, skipped: 4 });
    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(8);
  });

  it("every landed row has externalRef set; WJ-1004 pivots 1/5/29 -> 2029-01-05", async () => {
    await commitImport({ csvText: fixtureCsv });
    const rows = await db.select().from(customers);
    expect(rows.every((r) => r.externalRef !== null)).toBe(true);

    const [wj1004] = await db
      .select()
      .from(customers)
      .where(eq(customers.externalRef, "WJ-1004"));
    expect(wj1004.firstSeenAt?.toISOString().slice(0, 10)).toBe("2029-01-05");
    // Review finding: assert a populated address survives the jsonb round-trip
    // (no street2 in the fixture row -> key absent, not empty string).
    expect(wj1004.address).toEqual({
      street1: "55 Market St",
      city: "San Francisco",
      state: "CA",
      zip: "94105",
      country: "US",
    });

    // WJ-1003 has no Customer Since column value in the fixture -> stays null.
    const [wj1003] = await db
      .select()
      .from(customers)
      .where(eq(customers.externalRef, "WJ-1003"));
    expect(wj1003.firstSeenAt).toBeNull();
  });

  it("row 8's data fully wins for WJ-1001, including clearing row 1's address (no partial merge)", async () => {
    await commitImport({ csvText: fixtureCsv });
    const [wj1001] = await db
      .select()
      .from(customers)
      .where(eq(customers.externalRef, "WJ-1001"));
    expect(wj1001.name).toBe("Priya Sharma-Patel");
    expect(wj1001.email).toBe("priya.patel@sharmagems.com");
    expect(wj1001.phone).toBe("212-555-0102");
    // Row 1 had a full address; row 8 has none — the winning row's (empty)
    // address must win outright, proving excluded.* overwrite semantics
    // rather than a field-by-field merge.
    expect(wj1001.address).toBeNull();
  });

  it("revalidates /customers on success", async () => {
    await commitImport({ csvText: fixtureCsv });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/customers");
  });
});

// ---------------------------------------------------------------------------
// commitImport — idempotency (the core proof of the slice)
// ---------------------------------------------------------------------------

describe("commitImport — idempotency", () => {
  it("re-committing the identical file updates instead of duplicating", async () => {
    const first = await commitImport({ csvText: fixtureCsv });
    expect(first).toEqual({ ok: true, created: 8, updated: 0, skipped: 4 });

    const second = await commitImport({ csvText: fixtureCsv });
    expect(second).toEqual({ ok: true, created: 0, updated: 8, skipped: 4 });

    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// commitImport — cross-org isolation
// ---------------------------------------------------------------------------

describe("commitImport — cross-org isolation", () => {
  it("leaves an identical external_ref row in a different org byte-identical", async () => {
    // org 999 ("Fixture Org") is pre-seeded by the shared-db harness
    // specifically for cross-org isolation tests (see test/helpers/shared-db.ts).
    const [otherOrgRow] = await db
      .insert(customers)
      .values({
        orgId: 999,
        name: "Org 999 Priya",
        externalRef: "WJ-1001",
        email: "untouched@example.com",
      })
      .returning();

    await commitImport({ csvText: fixtureCsv });

    const [after] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, otherOrgRow.id));
    expect(after).toEqual(otherOrgRow);

    const org999Rows = await db
      .select()
      .from(customers)
      .where(eq(customers.orgId, 999));
    expect(org999Rows).toHaveLength(1);

    // And org 1 still got its own independent WJ-1001 row.
    const org1Rows = await db
      .select()
      .from(customers)
      .where(eq(customers.orgId, 1));
    expect(org1Rows).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

describe("caps", () => {
  it("rejects csvText over 5MB without ever reaching the parser", async () => {
    // The tail is deliberately an unterminated quoted field — if the Zod
    // boundary didn't short-circuit BEFORE parseCsv, parseCsv would throw
    // "Unterminated quoted field..." instead of a size-cap error.
    const big = "a".repeat(5 * 1024 * 1024 + 1) + '\n"unterminated';
    const res = await previewImport({ csvText: big });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toMatch(/unterminated/i);
  });

  it("rejects a file over 5MB in BYTES even when under 5M UTF-16 code units", async () => {
    // Review finding: z.string().max() counts UTF-16 code units — a CJK-heavy
    // file at ~4M code units is ~12MB of UTF-8 bytes and sailed past the old
    // "5MB" check. The byteLength refine closes it.
    const cjkRow = "一丁丂".repeat(500); // 1500 code units, 4500 bytes
    const rows = Array.from({ length: 2800 }, (_, i) => `WJ-C${i},${cjkRow}`);
    const big = `Cust#,Contact\n${rows.join("\n")}`;
    expect(big.length).toBeLessThan(5 * 1024 * 1024); // passes the code-unit screen
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(5 * 1024 * 1024); // over in bytes
    const res = await previewImport({ csvText: big });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/too large/i);
  });

  it("rejects a 5001-row CSV (post-parse cap, not a truncation)", async () => {
    const res = await previewImport({ csvText: genMinimalCsv(5001) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/5000/);
  });

  it("a 5000-row CSV is exactly at the boundary and is allowed", async () => {
    const res = await previewImport({ csvText: genMinimalCsv(5000) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalRows).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// demo mode
// ---------------------------------------------------------------------------

describe("demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("previewImport is blocked and performs no query", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res).toEqual({
      ok: false,
      error: "Demo mode — changes are disabled",
    });
  });

  it("commitImport is blocked and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await commitImport({ csvText: fixtureCsv });
    expect(res).toEqual({
      ok: false,
      error: "Demo mode — changes are disabled",
    });
    expect(await db.select().from(customers)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("previewImport returns Unauthorized with no session", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await previewImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("commitImport returns Unauthorized with no session and writes nothing", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await commitImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(customers)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

describe("audit", () => {
  it("records exactly ONE event: verb 'imported', entityType 'org', counts-only payload, no PII", async () => {
    await commitImport({ csvText: fixtureCsv });
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.verb, "imported"));
    expect(events).toHaveLength(1);
    const [ev] = events;
    expect(ev.entityType).toBe("org");
    expect(ev.entityId).toBe(1);
    expect(ev.actor).toBe("boss");
    expect(ev.payload).toEqual({
      totalRows: 12,
      created: 8,
      updated: 0,
      skipped: 4,
    });
    const serialized = JSON.stringify({
      payload: ev.payload,
      summary: ev.summary,
    });
    expect(serialized).not.toContain("@");
  });

  it("re-committing produces a second, independent audit event with updated counts", async () => {
    await commitImport({ csvText: fixtureCsv });
    await commitImport({ csvText: fixtureCsv });
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.verb, "imported"));
    expect(events).toHaveLength(2);
    expect(events[1]!.payload).toEqual({
      totalRows: 12,
      created: 0,
      updated: 8,
      skipped: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// chunking (bulk beyond one 500-row chunk, both for the membership SELECT
// and the UPSERT) — the fixture is too small to exercise this path.
// ---------------------------------------------------------------------------

describe("commitImport — chunking crosses a 500-row boundary correctly", () => {
  it("commits 520 unique rows then re-commits idempotently, no drops or dupes", async () => {
    const csvText = genMinimalCsv(520);
    const first = await commitImport({ csvText });
    expect(first).toEqual({ ok: true, created: 520, updated: 0, skipped: 0 });
    expect(await db.select().from(customers)).toHaveLength(520);

    const second = await commitImport({ csvText });
    expect(second).toEqual({
      ok: true,
      created: 0,
      updated: 520,
      skipped: 0,
    });
    expect(await db.select().from(customers)).toHaveLength(520);
  }, 30000);
});

// ---------------------------------------------------------------------------
// regression — the slice-22 closure (manual create can't write external_ref)
// ---------------------------------------------------------------------------

describe("regression — manual createCustomer still cannot write external_ref", () => {
  it("createCustomer rows keep externalRef null", async () => {
    const res = await createCustomer({ name: "Direct Add" });
    expect(res.ok).toBe(true);
    const rows = await db.select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalRef).toBeNull();
  });
});
