// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { customers, invoices, payments, customerHealthSnapshots, revenueMonths, profitMonths } from "@/db/schema";
import { collectInvestorKpis } from "@/lib/investor/collect";

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

// ---------------------------------------------------------------------------
// Fixtures — local inserts, following the shared-db seed helper pattern from
// test/db/runway.test.ts / test/lib/payments/actions.test.ts.
// ---------------------------------------------------------------------------

async function insertCustomer(overrides: Partial<{ orgId: number; name: string }> = {}) {
  const [row] = await db
    .insert(customers)
    .values({ orgId: overrides.orgId ?? 1, name: overrides.name ?? "Test Customer" })
    .returning();
  return row!;
}

let invoiceCounter = 0;

async function insertInvoice(overrides: {
  orgId?: number;
  customerId: number;
  status?: "draft" | "issued" | "void";
  totalCents?: number;
  issueDate?: string | null;
  dueDate?: string | null;
}) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 1_000;
  const status = overrides.status ?? "issued";
  const [row] = await db
    .insert(invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      invoiceNumber: `INV-TEST-${String(invoiceCounter).padStart(4, "0")}`,
      status,
      billTo: { name: "Test Customer" },
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: overrides.issueDate === undefined ? "2026-07-15" : overrides.issueDate,
      dueDate: overrides.dueDate ?? null,
    })
    .returning();
  return row!;
}

async function insertPayment(overrides: {
  orgId?: number;
  invoiceId: number;
  amountCents?: number;
  receivedDate?: string;
}) {
  const [row] = await db
    .insert(payments)
    .values({
      orgId: overrides.orgId ?? 1,
      invoiceId: overrides.invoiceId,
      amountCents: overrides.amountCents ?? 500,
      method: "cash",
      receivedDate: overrides.receivedDate ?? "2026-07-15",
    })
    .returning();
  return row!;
}

async function insertSnapshot(overrides: {
  orgId?: number;
  customerId: number;
  band: "healthy" | "watch" | "at_risk";
  capturedOn: string;
  score?: number;
}) {
  const [row] = await db
    .insert(customerHealthSnapshots)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      score: overrides.score ?? 50,
      band: overrides.band,
      components: { recency: 10, frequency: 10, breadth: 10 },
      capturedOn: overrides.capturedOn,
    })
    .returning();
  return row!;
}

// Fixed reference instant so "this UTC month" is always July 2026 regardless
// of when the suite runs. Only the demo-mode test (bottom of file) uses real
// wall-clock `new Date()`, matching how the demo seed itself derives "now".
const REF_NOW = new Date("2026-07-15T12:00:00Z");

// ---------------------------------------------------------------------------

describe("collectInvestorKpis — periodLabel & orgName", () => {
  it("derives periodLabel from the injected now (en-US month + year, UTC) and resolves the org label", async () => {
    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.periodLabel).toBe("July 2026");
    expect(kpis.orgName).toBe("AIYA Designs");
  });
});

describe("collectInvestorKpis — invoicing (this UTC month, org-scoped)", () => {
  it("counts an invoice issued this month; excludes one issued last month", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, totalCents: 50_000, issueDate: "2026-07-10" });
    await insertInvoice({ customerId: c.id, totalCents: 30_000, issueDate: "2026-06-20" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.invoicing.issuedCount).toBe(1);
    expect(kpis.invoicing.issuedCents).toBe(50_000);
  });

  it("includes issue_date exactly on the 1st, excludes the 1st of next month and drafts (null issue_date)", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, totalCents: 10_000, issueDate: "2026-07-01" });
    await insertInvoice({ customerId: c.id, totalCents: 99_000, issueDate: "2026-08-01" });
    await insertInvoice({ customerId: c.id, totalCents: 77_000, status: "draft", issueDate: null });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.invoicing.issuedCount).toBe(1);
    expect(kpis.invoicing.issuedCents).toBe(10_000);
  });
});

describe("collectInvestorKpis — collected payments (this UTC month, org-scoped)", () => {
  it("sums only payments whose received_date falls in this month", async () => {
    const c = await insertCustomer();
    const invoice = await insertInvoice({ customerId: c.id, totalCents: 100_000 });
    await insertPayment({ invoiceId: invoice.id, amountCents: 20_000, receivedDate: "2026-07-05" });
    await insertPayment({ invoiceId: invoice.id, amountCents: 15_000, receivedDate: "2026-06-28" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.invoicing.collectedCents).toBe(20_000);
  });
});

describe("collectInvestorKpis — org scoping (adversarial org 999)", () => {
  it("org-999 invoices, payments, customers, and snapshots are all invisible to org 1", async () => {
    const foreignCustomer = await insertCustomer({ orgId: 999, name: "Foreign Customer" });
    const foreignInvoice = await insertInvoice({
      orgId: 999,
      customerId: foreignCustomer.id,
      totalCents: 987_000,
      issueDate: "2026-07-12",
    });
    await insertPayment({
      orgId: 999,
      invoiceId: foreignInvoice.id,
      amountCents: 111_000,
      receivedDate: "2026-07-12",
    });
    await insertSnapshot({ orgId: 999, customerId: foreignCustomer.id, band: "at_risk", capturedOn: "2026-07-12" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.invoicing.issuedCount).toBe(0);
    expect(kpis.invoicing.issuedCents).toBe(0);
    expect(kpis.invoicing.collectedCents).toBe(0);
    expect(kpis.customers.total).toBe(0);
    expect(kpis.customers.healthMix).toBeNull();
    expect(kpis.receivables).toEqual({ totalCents: 0, count: 0, overdueCents: 0 });
  });
});

describe("collectInvestorKpis — customers total", () => {
  it("counts only this org's customers", async () => {
    await insertCustomer({ name: "A" });
    await insertCustomer({ name: "B" });
    await insertCustomer({ name: "C" });
    await insertCustomer({ orgId: 999, name: "Foreign" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.customers.total).toBe(3);
  });
});

describe("collectInvestorKpis — customer health mix", () => {
  it("uses only the latest snapshot per customer (later capturedOn's band wins, counted once)", async () => {
    const c1 = await insertCustomer({ name: "Customer A" });
    const c2 = await insertCustomer({ name: "Customer B" });
    // c1: healthy -> at_risk. Only the LATER (at_risk) row should count.
    await insertSnapshot({ customerId: c1.id, band: "healthy", capturedOn: "2026-06-01" });
    await insertSnapshot({ customerId: c1.id, band: "at_risk", capturedOn: "2026-06-15" });
    await insertSnapshot({ customerId: c2.id, band: "watch", capturedOn: "2026-06-10" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.customers.healthMix).toEqual({ healthy: 0, watch: 1, at_risk: 1 });
  });

  it("is null when the org has no snapshots at all", async () => {
    await insertCustomer();
    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.customers.healthMix).toBeNull();
  });
});

describe("collectInvestorKpis — receivables & overdue", () => {
  it("overdueCents sums only the overdue buckets (d1_30 + d31_60 + d61_plus), excluding current", async () => {
    const c = await insertCustomer();
    // Reference date is dueDate ?? issueDate; "today" is 2026-07-15.
    // Not overdue (due in the future) -> "current" bucket.
    await insertInvoice({ customerId: c.id, totalCents: 40_000, issueDate: "2026-06-01", dueDate: "2026-08-01" });
    // 44 days overdue (2026-06-01 -> 2026-07-15) -> "d31_60" bucket.
    await insertInvoice({ customerId: c.id, totalCents: 60_000, issueDate: "2026-05-01", dueDate: "2026-06-01" });

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.receivables.count).toBe(2);
    expect(kpis.receivables.totalCents).toBe(100_000);
    expect(kpis.receivables.overdueCents).toBe(60_000);
  });
});

describe("collectInvestorKpis — legacy revenue/profit + runway when nothing is seeded", () => {
  it("revenue/profit are empty with a null latestCents, and runway is insufficient_history", async () => {
    const kpis = await collectInvestorKpis(db, 1, REF_NOW);
    expect(kpis.revenue).toEqual({ months: [], latestCents: null });
    expect(kpis.profit).toEqual({ months: [], latestCents: null });
    expect(kpis.runway).toEqual({ kind: "insufficient_history", monthsAvailable: 0 });
  });
});

describe("collectInvestorKpis — revenue/profit month shapes", () => {
  it("returns most-recent-first { ym, cents } rows with correct labels across a year boundary", async () => {
    await db.insert(revenueMonths).values([
      { year: 2025, month: 11, amountCents: 100_00 },
      { year: 2025, month: 12, amountCents: 200_00 },
      { year: 2026, month: 1, amountCents: 300_00 },
      { year: 2026, month: 2, amountCents: 400_00 },
    ]);
    await db.insert(profitMonths).values([
      { year: 2025, month: 11, amountCents: -50_00 },
      { year: 2025, month: 12, amountCents: -20_00 },
      { year: 2026, month: 1, amountCents: 10_00 },
      { year: 2026, month: 2, amountCents: 30_00 },
    ]);

    const kpis = await collectInvestorKpis(db, 1, REF_NOW);

    expect(kpis.revenue.months).toEqual([
      { ym: "2026-02", cents: 400_00 },
      { ym: "2026-01", cents: 300_00 },
      { ym: "2025-12", cents: 200_00 },
      { ym: "2025-11", cents: 100_00 },
    ]);
    expect(kpis.revenue.latestCents).toBe(400_00);

    expect(kpis.profit.months).toEqual([
      { ym: "2026-02", cents: 30_00 },
      { ym: "2026-01", cents: 10_00 },
      { ym: "2025-12", cents: -20_00 },
      { ym: "2025-11", cents: -50_00 },
    ]);
    expect(kpis.profit.latestCents).toBe(30_00);
  });
});

describe("collectInvestorKpis — demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("yields a fully-populated InvestorKpis: the demo receivable total flows through and runway is burning", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const kpis = await collectInvestorKpis(db, 1, new Date());

    // Invoice 9302 is demo's only outstanding receivable: totalCents
    // 2,985,000 minus the two seeded payments (40% + 20% of that total)
    // leaves exactly 1,194,000 — same figure test/db/runway.test.ts's demo
    // receivables test locks (computed there, asserted literally here).
    expect(kpis.receivables.totalCents).toBe(1_194_000);
    expect(kpis.receivables.count).toBe(1);
    expect(kpis.runway.kind).toBe("burning");

    // Every other field resolves to a well-shaped value (no crash, nothing
    // left undefined) — the org-scoped demo readers all have seed data.
    expect(kpis.orgName.length).toBeGreaterThan(0);
    expect(kpis.periodLabel.length).toBeGreaterThan(0);
    expect(kpis.customers.total).toBe(10);
    expect(kpis.customers.healthMix).toEqual({ healthy: 0, watch: 2, at_risk: 0 });
    expect(typeof kpis.invoicing.issuedCount).toBe("number");
    expect(typeof kpis.invoicing.issuedCents).toBe("number");
    expect(typeof kpis.invoicing.collectedCents).toBe("number");
  });
});
