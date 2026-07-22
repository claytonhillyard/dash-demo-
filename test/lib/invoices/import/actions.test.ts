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
import { customers, invoices, invoiceItems, payments, activityEvents } from "@/db/schema";
import {
  previewInvoiceImport,
  commitInvoiceImport,
  __setTestDb,
} from "@/lib/invoices/import/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

// Contract: spec §4 + §7 (docs/superpowers/specs/2026-07-20-winjewel-invoice-import-slice-30-design.md).
//
// Fixture row inventory (test/fixtures/winjewel-invoices.csv, authored in
// 30-1) — derived arithmetic, verified against the file below:
//   row 1  INV-2001 WJ-101 Priya Sharma   issued  500.00/500.00   -> importable
//   row 2  INV-2002 WJ-102 Owen Clarke    issued 1200.00/400.00   -> importable
//   row 3  INV-2003 WJ-103 Fatima Noor    issued  300.00/(blank)  -> importable
//   row 4  INV-2004 WJ-104 Diego Alvarez  void    800.00/800.00   -> importable
//   row 5  INV-2005 WJ-105 Grace Kim      void    250.00/0        -> importable
//   row 6  INV-2006 WJ-101 Priya Sharma   issued  600.00/600.00 (MM/DD dates) -> importable
//   row 7  INV-2007 WJ-102 Owen Clarke    issued 1234.56/234.56 ($+comma)     -> importable
//   row 8  INV-2008 WJ-103 Fatima Noor    paid(150)>total(100) -> preset-level skip
//   row 9  INV-2009 WJ-999 (blank name)   unresolvable customer -> action-level skip
//   row 10 INV-2001 WJ-105 Grace Kim      duplicate of row 1's number -> duplicate
// => 7 importable / 1 duplicate / 2 skipped, totalRows 10.
// Of the 7 importable rows, paidCents > 0 for rows 1,2,4,6,7 (5 rows) ->
// first commit expects payments: 5.

const FIXTURE_PATH = "test/fixtures/winjewel-invoices.csv";
const fixtureCsv = readFileSync(FIXTURE_PATH, "utf8");

const HEADER = "Invoice No,Customer ID,Customer Name,Invoice Date,Due Date,Total,Paid,Status";

/** Builds one ad hoc data row against the fixture's header shape, for tests
 *  that need a scenario the fixture itself doesn't cover (ambiguous name,
 *  ref-beats-name, cross-org). */
function csvRow(fields: {
  invoiceNumber: string;
  customerRef?: string;
  customerName?: string;
  issueDate: string;
  dueDate?: string;
  total: string;
  paid?: string;
  status?: string;
}): string {
  return [
    fields.invoiceNumber,
    fields.customerRef ?? "",
    fields.customerName ?? "",
    fields.issueDate,
    fields.dueDate ?? "",
    fields.total,
    fields.paid ?? "",
    fields.status ?? "",
  ].join(",");
}

function buildCsv(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

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

/** Seeds org-1 with the five customers the fixture's refs/names resolve
 *  against. Priya Sharma gets an email + address so the billTo-snapshot
 *  equality test is meaningful (a customer with every optional field
 *  populated). */
async function seedBaseCustomers(): Promise<void> {
  await db.insert(customers).values([
    {
      orgId: 1,
      name: "Priya Sharma",
      externalRef: "WJ-101",
      email: "priya.sharma@example.com",
      address: {
        street1: "12 Gem Row",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "US",
      },
    },
    { orgId: 1, name: "Owen Clarke", externalRef: "WJ-102" },
    { orgId: 1, name: "Fatima Noor", externalRef: "WJ-103" },
    { orgId: 1, name: "Diego Alvarez", externalRef: "WJ-104" },
    { orgId: 1, name: "Grace Kim", externalRef: "WJ-105" },
  ]);
}

async function customerIdByRef(ref: string): Promise<number> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.externalRef, ref));
  if (!row) throw new Error(`no seeded customer with externalRef ${ref}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// previewInvoiceImport — fixture arithmetic
// ---------------------------------------------------------------------------

describe("previewInvoiceImport — fixture arithmetic (test/fixtures/winjewel-invoices.csv)", () => {
  it("computes importable/duplicates/skipped exactly: 7 / 1 / 2 (totalRows 10)", async () => {
    await seedBaseCustomers();
    const res = await previewInvoiceImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalRows).toBe(10);
    expect(res.importable).toBe(7);
    expect(res.duplicates).toBe(1);
    expect(res.skipped).toBe(2);
  });

  it("sampleSkipped carries row 8's preset reason and row 9's not-found reason; sampleDuplicates carries row 10", async () => {
    await seedBaseCustomers();
    const res = await previewInvoiceImport({ csvText: fixtureCsv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row8 = res.sampleSkipped.find((r) => r.rowIndex === 8);
    expect(row8?.reason).toBe("paid exceeds total — fix the export row");

    const row9 = res.sampleSkipped.find((r) => r.rowIndex === 9);
    expect(row9?.reason).toBe("customer not found — import customers first");

    const row10 = res.sampleDuplicates.find((r) => r.rowIndex === 10);
    expect(row10).toBeDefined();
    expect(row10?.invoiceNumber).toBe("INV-2001");
  });

  it("does not write anything to the db", async () => {
    await seedBaseCustomers();
    await previewInvoiceImport({ csvText: fixtureCsv });
    expect(await db.select().from(invoices)).toHaveLength(0);
    expect(await db.select().from(invoiceItems)).toHaveLength(0);
    expect(await db.select().from(payments)).toHaveLength(0);
    expect(await db.select().from(activityEvents)).toHaveLength(0);
  });

  it("does not revalidate any path (read-only)", async () => {
    await seedBaseCustomers();
    await previewInvoiceImport({ csvText: fixtureCsv });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewInvoiceImport — customer resolution rules (spec §4.1)
// ---------------------------------------------------------------------------

describe("previewInvoiceImport — customer resolution rules", () => {
  it("ref match wins even when the row's customerName matches a DIFFERENT customer", async () => {
    await seedBaseCustomers();
    const csv = buildCsv([
      csvRow({
        invoiceNumber: "INV-9001",
        customerRef: "WJ-101", // Priya Sharma's ref
        customerName: "Owen Clarke", // a different customer's name
        issueDate: "2025-03-01",
        total: "100.00",
      }),
    ]);
    const res = await previewInvoiceImport({ csvText: csv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.importable).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it("resolves by name, case-insensitively, when no ref is present", async () => {
    await seedBaseCustomers();
    const csv = buildCsv([
      csvRow({
        invoiceNumber: "INV-9002",
        customerName: "priya SHARMA",
        issueDate: "2025-03-02",
        total: "50.00",
      }),
    ]);
    const res = await previewInvoiceImport({ csvText: csv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.importable).toBe(1);
    expect(res.skipped).toBe(0);
  });

  it("skips 'ambiguous customer name' when two customers share a name and the row has no ref", async () => {
    await db.insert(customers).values([
      { orgId: 1, name: "Jordan Lee" },
      { orgId: 1, name: "Jordan Lee" },
    ]);
    const csv = buildCsv([
      csvRow({
        invoiceNumber: "INV-9003",
        customerName: "Jordan Lee",
        issueDate: "2025-03-03",
        total: "75.00",
      }),
    ]);
    const res = await previewInvoiceImport({ csvText: csv });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.importable).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.sampleSkipped[0]?.reason).toBe("ambiguous customer name");
  });
});

// ---------------------------------------------------------------------------
// commitInvoiceImport — happy path (exact cents, item shape, conditional payment)
// ---------------------------------------------------------------------------

describe("commitInvoiceImport — fixture happy path", () => {
  it("creates 7 invoices, 5 payments, reports 1 duplicate + 2 skipped", async () => {
    await seedBaseCustomers();
    const res = await commitInvoiceImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: true, created: 7, payments: 5, duplicates: 1, skipped: 2 });
    expect(await db.select().from(invoices)).toHaveLength(7);
    expect(await db.select().from(invoiceItems)).toHaveLength(7);
    expect(await db.select().from(payments)).toHaveLength(5);
  });

  it("INV-2007 lands with exact cents on the invoice, its one item, and its payment", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.invoiceNumber, "INV-2007"));
    expect(invoice).toBeDefined();
    expect(invoice.totalCents).toBe(123456);
    expect(invoice.subtotalCents).toBe(123456);
    expect(invoice.taxCents).toBe(0);
    expect(invoice.taxRateBps).toBe(0);
    expect(invoice.currency).toBe("USD");
    expect(invoice.status).toBe("issued");

    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
    expect(items).toHaveLength(1);
    expect(items[0]!.position).toBe(0);
    expect(items[0]!.description).toBe("Imported from WinJewel — historical invoice");
    expect(items[0]!.quantity).toBe(1);
    expect(items[0]!.unitPriceCents).toBe(123456);
    expect(items[0]!.lineTotalCents).toBe(123456);

    const pays = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.amountCents).toBe(23456);
    expect(pays[0]!.method).toBe("other");
    expect(pays[0]!.receivedDate).toBe(invoice.issueDate);
    expect(pays[0]!.note).toBe("Imported from WinJewel");
  });

  it("rows with paidCents 0 create NO payment row (INV-2003 unpaid, INV-2005 void-unpaid)", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });

    const [inv2003] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "INV-2003"));
    const [inv2005] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "INV-2005"));
    expect(await db.select().from(payments).where(eq(payments.invoiceId, inv2003!.id))).toHaveLength(0);
    expect(await db.select().from(payments).where(eq(payments.invoiceId, inv2005!.id))).toHaveLength(0);
    expect(inv2005!.status).toBe("void");
  });

  it("void row INV-2004 imports with status void AND its payment (refund-history case)", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });

    const [inv2004] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "INV-2004"));
    expect(inv2004!.status).toBe("void");
    const pays = await db.select().from(payments).where(eq(payments.invoiceId, inv2004!.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.amountCents).toBe(80000);
  });

  it("billTo snapshot matches the matched customer's CURRENT name/email/address", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });

    const [inv2001] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "INV-2001"));
    expect(inv2001!.billTo).toEqual({
      name: "Priya Sharma",
      email: "priya.sharma@example.com",
      address: {
        street1: "12 Gem Row",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "US",
      },
    });
  });

  it("ref-matched row's billTo/customerId come from the ref target, ignoring a mismatched customerName", async () => {
    await seedBaseCustomers();
    const csv = buildCsv([
      csvRow({
        invoiceNumber: "INV-9001",
        customerRef: "WJ-101",
        customerName: "Owen Clarke",
        issueDate: "2025-03-01",
        total: "100.00",
      }),
    ]);
    const res = await commitInvoiceImport({ csvText: csv });
    expect(res).toEqual({ ok: true, created: 1, payments: 0, duplicates: 0, skipped: 0 });

    const priyaId = await customerIdByRef("WJ-101");
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "INV-9001"));
    expect(invoice!.customerId).toBe(priyaId);
    expect((invoice!.billTo as { name: string }).name).toBe("Priya Sharma");
  });

  it("revalidates /invoices on successful commit", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });
    const calls = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(calls).toContain("/invoices");
  });
});

// ---------------------------------------------------------------------------
// commitInvoiceImport — idempotency (THE critical proof of the slice)
// ---------------------------------------------------------------------------

describe("commitInvoiceImport — idempotency", () => {
  it("committing the identical file twice inserts ZERO new invoices/items/payments the second time", async () => {
    await seedBaseCustomers();
    const first = await commitInvoiceImport({ csvText: fixtureCsv });
    expect(first).toEqual({ ok: true, created: 7, payments: 5, duplicates: 1, skipped: 2 });

    const invoicesAfterFirst = await db.select().from(invoices);
    const itemsAfterFirst = await db.select().from(invoiceItems);
    const paymentsAfterFirst = await db.select().from(payments);
    expect(invoicesAfterFirst).toHaveLength(7);
    expect(itemsAfterFirst).toHaveLength(7);
    expect(paymentsAfterFirst).toHaveLength(5);

    const second = await commitInvoiceImport({ csvText: fixtureCsv });
    // Every row that landed last time now pre-exists in the db, so all 8
    // file-rows referencing an already-used number (rows 1-7 plus the
    // original in-file duplicate, row 10) are "duplicate" this time; the
    // 2 preset/not-found skips are unaffected.
    expect(second).toEqual({ ok: true, created: 0, payments: 0, duplicates: 8, skipped: 2 });

    const invoicesAfterSecond = await db.select().from(invoices);
    const itemsAfterSecond = await db.select().from(invoiceItems);
    const paymentsAfterSecond = await db.select().from(payments);
    expect(invoicesAfterSecond).toHaveLength(7);
    expect(itemsAfterSecond).toHaveLength(7);
    expect(paymentsAfterSecond).toHaveLength(5);
    // Byte-identical row sets, not just matching counts (catches a
    // delete+reinsert bug that would churn ids/timestamps invisibly to a
    // length-only assertion).
    expect(invoicesAfterSecond).toEqual(invoicesAfterFirst);
    expect(itemsAfterSecond).toEqual(itemsAfterFirst);
    expect(paymentsAfterSecond).toEqual(paymentsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// cross-org isolation
// ---------------------------------------------------------------------------

describe("cross-org isolation", () => {
  it("an org-999 customer sharing ref WJ-101 is invisible to org-1's resolution", async () => {
    // org 999 ("Fixture Org") is pre-seeded by the shared-db harness.
    await db.insert(customers).values({
      orgId: 999,
      name: "Org999 Priya",
      externalRef: "WJ-101",
    });
    // Deliberately do NOT seed org-1's own WJ-101 customer for this test.
    const csv = buildCsv([
      csvRow({
        invoiceNumber: "INV-X1",
        customerRef: "WJ-101",
        issueDate: "2025-01-01",
        total: "10.00",
      }),
    ]);

    const preview = await previewInvoiceImport({ csvText: csv });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.importable).toBe(0);
    expect(preview.skipped).toBe(1);
    expect(preview.sampleSkipped[0]?.reason).toBe("customer not found — import customers first");

    const commitRes = await commitInvoiceImport({ csvText: csv });
    expect(commitRes).toEqual({ ok: true, created: 0, payments: 0, duplicates: 0, skipped: 1 });
    expect(await db.select().from(invoices).where(eq(invoices.orgId, 1))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

describe("caps", () => {
  it("rejects csvText over 5MB without ever reaching the parser", async () => {
    const big = "a".repeat(5 * 1024 * 1024 + 1) + '\n"unterminated';
    const res = await previewInvoiceImport({ csvText: big });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toMatch(/unterminated/i);
  });

  it("rejects a file over 5MB in BYTES even when under 5M UTF-16 code units", async () => {
    const cjkRow = "一丁丂".repeat(500); // 1500 code units, 4500 bytes
    const rows = Array.from(
      { length: 2800 },
      (_, i) => `INV-C${i},WJ-101,${cjkRow},2025-01-01,,100.00,0,`,
    );
    const big = `${HEADER}\n${rows.join("\n")}`;
    expect(big.length).toBeLessThan(5 * 1024 * 1024); // passes the code-unit screen
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(5 * 1024 * 1024); // over in bytes
    const res = await previewInvoiceImport({ csvText: big });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/too large/i);
  });
});

// ---------------------------------------------------------------------------
// demo mode
// ---------------------------------------------------------------------------

describe("demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("previewInvoiceImport is blocked and performs no query", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await previewInvoiceImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });

  it("commitInvoiceImport is blocked and writes nothing", async () => {
    await seedBaseCustomers();
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await commitInvoiceImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await db.select().from(invoices)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("previewInvoiceImport returns Unauthorized with no session", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await previewInvoiceImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("commitInvoiceImport returns Unauthorized with no session and writes nothing", async () => {
    (
      requireSession as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("Unauthorized"));
    const res = await commitInvoiceImport({ csvText: fixtureCsv });
    expect(res).toEqual({ ok: false, error: "Unauthorized" });
    expect(await db.select().from(invoices)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

describe("audit", () => {
  it("records exactly ONE 'imported' event: entityType org, counts-only payload, no names/emails", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.verb, "imported"));
    expect(events).toHaveLength(1);
    const [ev] = events;
    expect(ev!.entityType).toBe("org");
    expect(ev!.entityId).toBe(1);
    expect(ev!.actor).toBe("boss");
    expect(ev!.payload).toEqual({ created: 7, payments: 5, duplicates: 1, skipped: 2 });
    expect(ev!.summary).toBe(
      "Imported 7 invoices from WinJewel (5 payments, 1 duplicates, 2 skipped)",
    );
    const serialized = JSON.stringify({ payload: ev!.payload, summary: ev!.summary });
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("Priya");
  });

  it("re-committing produces a second, independent audit event with updated counts", async () => {
    await seedBaseCustomers();
    await commitInvoiceImport({ csvText: fixtureCsv });
    await commitInvoiceImport({ csvText: fixtureCsv });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.verb, "imported"));
    expect(events).toHaveLength(2);
    expect(events[1]!.payload).toEqual({ created: 0, payments: 0, duplicates: 8, skipped: 2 });
  });
});
