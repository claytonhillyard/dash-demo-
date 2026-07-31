// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import * as schema from "@/db/schema";
import { getReceivablesRows, getTrailingProfitMonths } from "@/db/runway";
import { computeReceivablesAging, computeRunway } from "@/lib/runway/compute";
import { formatRunwayVerdict } from "@/lib/investor/narrative";
import { formatCentsExact } from "@/lib/company/format";
import { toUtcDay } from "@/lib/sentinel/capture";
import { COMMANDS, HELP_EXAMPLES, HELP_RESULT } from "@/lib/command/registry";

/**
 * Registry + executor tests (spec §3, §7 row 1). Shared-db harness (see
 * test/db/runway.test.ts / test/lib/investor/collect.test.ts for the same
 * pattern this file follows): one migrated pglite per file, truncated
 * between tests. Every executor is org-scoped, so every describe block
 * seeds at least one org-999 adversarial row to prove isolation — except
 * revenue_trend, whose backing tables are the legacy single-tenant
 * revenue_months/profit_months (no org_id column at all — see the executor's
 * own doc comment and src/lib/investor/collect.ts's identical rationale).
 */

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
// Fixtures — same shape/idiom as test/db/runway.test.ts and
// test/lib/investor/collect.test.ts.
// ---------------------------------------------------------------------------

async function insertCustomer(
  overrides: Partial<{ orgId: number; name: string; businessName: string | null; styleNote: string | null }> = {},
) {
  const [row] = await db
    .insert(schema.customers)
    .values({
      orgId: overrides.orgId ?? 1,
      name: overrides.name ?? "Test Customer",
      businessName: overrides.businessName ?? null,
      styleNote: overrides.styleNote ?? null,
    })
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
  billToName?: string;
}) {
  invoiceCounter += 1;
  const totalCents = overrides.totalCents ?? 1_000;
  const [row] = await db
    .insert(schema.invoices)
    .values({
      orgId: overrides.orgId ?? 1,
      customerId: overrides.customerId,
      invoiceNumber: `INV-TEST-${String(invoiceCounter).padStart(4, "0")}`,
      status: overrides.status ?? "issued",
      billTo: { name: overrides.billToName ?? "Test Customer" },
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      issueDate: overrides.issueDate === undefined ? "2026-07-01" : overrides.issueDate,
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
    .insert(schema.payments)
    .values({
      orgId: overrides.orgId ?? 1,
      invoiceId: overrides.invoiceId,
      amountCents: overrides.amountCents ?? 100,
      method: "cash",
      receivedDate: overrides.receivedDate ?? "2026-07-01",
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
    .insert(schema.customerHealthSnapshots)
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

async function insertActivity(overrides: {
  orgId?: number;
  entityType?: string;
  entityId?: number | null;
  verb?: string;
  summary?: string;
  createdAt?: Date;
}) {
  const [row] = await db
    .insert(schema.activityEvents)
    .values({
      orgId: overrides.orgId ?? 1,
      entityType: overrides.entityType ?? "customer",
      entityId: overrides.entityId ?? 1,
      verb: overrides.verb ?? "created",
      summary: overrides.summary ?? "test event",
      actor: "test-user",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning();
  return row!;
}

/** "YYYY-MM-DD" for `offsetDays` from real wall-clock now — matches exactly
 *  what the executors compute internally (`toUtcDay(new Date())`), evaluated
 *  a few ms apart in the same test process. Same real-clock tolerance
 *  test/lib/investor/collect.test.ts's own demo-mode test already accepts. */
function utcYmd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

describe("registry — catalog shape", () => {
  it("COMMANDS has exactly the 8 spec ids, each self-consistent", () => {
    const ids = Object.keys(COMMANDS).sort();
    expect(ids).toEqual(
      [
        "at_risk_customers",
        "customer_lookup",
        "overdue_invoices",
        "receivables_summary",
        "recent_activity",
        "revenue_trend",
        "runway",
        "unpaid_by_customer",
      ].sort(),
    );
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      expect(cmd.id).toBe(key);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.examples.length).toBeGreaterThanOrEqual(3);
      expect(typeof cmd.run).toBe("function");
    }
  });

  it("HELP_RESULT lists every command's first example; HELP_EXAMPLES matches it exactly", () => {
    expect(HELP_RESULT.kind).toBe("help");
    if (HELP_RESULT.kind !== "help") throw new Error("unreachable");
    expect(HELP_RESULT.examples).toEqual(HELP_EXAMPLES);
    expect(HELP_EXAMPLES).toHaveLength(8);
    expect(HELP_RESULT.intro.length).toBeGreaterThan(0);
  });

  it("first examples align with the plan's own demo phrasings", () => {
    // docs/superpowers/plans/2026-07-23-command-palette-slice-35a.md's Done
    // condition quotes these three verbatim as what the rules matcher (task
    // 35a-2) must route correctly from seed data — anchoring them here now
    // means task 2 doesn't have to guess at wording.
    expect(COMMANDS.overdue_invoices.examples[0]).toBe("who owes me money");
    expect(COMMANDS.runway.examples[0]).toBe("how's my runway");
    expect(COMMANDS.at_risk_customers.examples[0]).toBe("show at-risk customers");
  });
});

describe("overdue_invoices", () => {
  it("boundary: due today is NOT overdue, due yesterday IS (default minDays 1); org-999 never appears", async () => {
    const c = await insertCustomer({ name: "Priya Mehta" });
    await insertInvoice({ customerId: c.id, totalCents: 5_000, dueDate: utcYmd(0), billToName: "Priya Mehta" });
    const dueYesterday = await insertInvoice({
      customerId: c.id,
      totalCents: 7_500,
      dueDate: utcYmd(-1),
      billToName: "Priya Mehta",
    });
    // Adversarial: a same-shape overdue invoice under a different org.
    const c999 = await insertCustomer({ orgId: 999, name: "Foreign" });
    await insertInvoice({ orgId: 999, customerId: c999.id, totalCents: 99_900, dueDate: utcYmd(-30) });

    const result = await COMMANDS.overdue_invoices.run(db, 1, { minDays: 1 });
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows).toEqual([[dueYesterday.invoiceNumber, "Priya Mehta", formatCentsExact(7_500), "1"]]);
    expect(result.links).toEqual([`/invoices/${dueYesterday.id}/edit`]);
  });

  it("minDays raises the bar", async () => {
    const c = await insertCustomer();
    const inv = await insertInvoice({ customerId: c.id, dueDate: utcYmd(-5) });

    const strict = await COMMANDS.overdue_invoices.run(db, 1, { minDays: 10 });
    const loose = await COMMANDS.overdue_invoices.run(db, 1, { minDays: 1 });
    if (strict.kind !== "table" || loose.kind !== "table") throw new Error("unreachable");
    expect(strict.rows).toHaveLength(0);
    expect(loose.rows.map((r) => r[0])).toEqual([inv.invoiceNumber]);
  });

  it("params schema defaults minDays to 1", () => {
    expect(COMMANDS.overdue_invoices.params.parse({})).toEqual({ minDays: 1 });
  });
});

describe("receivables_summary", () => {
  it("matches a direct computeReceivablesAging call over the same org's rows; org-999 excluded", async () => {
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, totalCents: 40_000, issueDate: "2026-06-01", dueDate: utcYmd(30) });
    await insertInvoice({ customerId: c.id, totalCents: 60_000, issueDate: "2026-05-01", dueDate: utcYmd(-45) });
    const c999 = await insertCustomer({ orgId: 999 });
    await insertInvoice({ orgId: 999, customerId: c999.id, totalCents: 500_000 });

    const rows = await getReceivablesRows(db, 1);
    const expectedAging = computeReceivablesAging(rows, toUtcDay(new Date()));

    const result = await COMMANDS.receivables_summary.run(db, 1, {});
    expect(result.kind).toBe("stat");
    if (result.kind !== "stat") throw new Error("unreachable");
    expect(result.value).toBe(formatCentsExact(expectedAging.totalCents));
    expect(result.detail).toContain(String(expectedAging.count));
  });
});

describe("runway", () => {
  it("stat.value equals formatRunwayVerdict fed by the org's trailing profit + receivables total; org-999 excluded", async () => {
    await db.insert(schema.profitMonths).values([
      { year: 2026, month: 1, amountCents: -100_00 },
      { year: 2026, month: 2, amountCents: -200_00 },
      { year: 2026, month: 3, amountCents: -300_00 },
    ]);
    const c = await insertCustomer();
    await insertInvoice({ customerId: c.id, totalCents: 90_000 });
    const c999 = await insertCustomer({ orgId: 999 });
    await insertInvoice({ orgId: 999, customerId: c999.id, totalCents: 10_000_000 });

    const trailingProfitCents = await getTrailingProfitMonths(db, 6);
    const rows = await getReceivablesRows(db, 1);
    const aging = computeReceivablesAging(rows, toUtcDay(new Date()));
    const expectedRunway = computeRunway({ trailingProfitCents, receivablesTotalCents: aging.totalCents });

    const result = await COMMANDS.runway.run(db, 1, {});
    expect(result.kind).toBe("stat");
    if (result.kind !== "stat") throw new Error("unreachable");
    expect(result.value).toBe(formatRunwayVerdict(expectedRunway));
  });

  it("insufficient_history when fewer than 3 months of profit exist", async () => {
    const result = await COMMANDS.runway.run(db, 1, {});
    if (result.kind !== "stat") throw new Error("unreachable");
    expect(result.value).toBe(formatRunwayVerdict({ kind: "insufficient_history", monthsAvailable: 0 }));
  });
});

describe("at_risk_customers", () => {
  it("latest snapshot per customer wins (dedup), filters by band, and org-999 never appears", async () => {
    const atRisk = await insertCustomer({ name: "Drifting Customer" });
    await insertSnapshot({ customerId: atRisk.id, band: "healthy", capturedOn: "2026-06-01" });
    await insertSnapshot({ customerId: atRisk.id, band: "at_risk", capturedOn: "2026-06-15" }); // later wins

    const watchOnly = await insertCustomer({ name: "Watch Customer" });
    await insertSnapshot({ customerId: watchOnly.id, band: "watch", capturedOn: "2026-06-10" });

    const c999 = await insertCustomer({ orgId: 999, name: "Foreign At Risk" });
    await insertSnapshot({ orgId: 999, customerId: c999.id, band: "at_risk", capturedOn: "2026-06-20" });

    const result = await COMMANDS.at_risk_customers.run(db, 1, { band: "at_risk" });
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows).toEqual([["Drifting Customer", "At risk", "2026-06-15"]]);
    expect(result.links).toEqual([`/customers/${atRisk.id}/edit`]);

    const watchResult = await COMMANDS.at_risk_customers.run(db, 1, { band: "watch" });
    if (watchResult.kind !== "table") throw new Error("unreachable");
    expect(watchResult.rows.map((r) => r[0])).toEqual(["Watch Customer"]);
  });
});

describe("customer_lookup", () => {
  it("0 matches returns a helpful list result, not an error", async () => {
    const result = await COMMANDS.customer_lookup.run(db, 1, { query: "Nobody Here" });
    expect(result.kind).toBe("list");
    if (result.kind !== "list") throw new Error("unreachable");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]!.text.toLowerCase()).toContain("no");
  });

  it("1 match (case-insensitive contains) surfaces balance/last-invoice/health and NEVER the private style note", async () => {
    const tanaka = await insertCustomer({
      name: "Yuki Tanaka",
      businessName: "Ginza Pearl House",
      styleNote: "SECRET_STYLE_MARKER_zzz",
    });
    const inv = await insertInvoice({ customerId: tanaka.id, totalCents: 20_000, issueDate: "2026-07-01" });
    await insertPayment({ invoiceId: inv.id, amountCents: 5_000 });
    await insertSnapshot({ customerId: tanaka.id, band: "watch", capturedOn: "2026-07-01" });

    const result = await COMMANDS.customer_lookup.run(db, 1, { query: "tanaka" }); // lowercase query
    expect(result.kind).toBe("list");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET_STYLE_MARKER_zzz");
    expect(serialized).toContain("Yuki Tanaka");
    expect(serialized).toContain(formatCentsExact(15_000)); // 20,000 - 5,000 balance
    expect(serialized).toContain(inv.invoiceNumber);
    expect(serialized.toLowerCase()).toContain("watch");
  });

  it("2+ matches returns a table with edit links; org-999 same-name customer never counted", async () => {
    const a = await insertCustomer({ name: "Yuki Tanaka" });
    const b = await insertCustomer({ name: "Yuki Yamamoto" });
    await insertCustomer({ orgId: 999, name: "Yuki Foreign" });

    const result = await COMMANDS.customer_lookup.run(db, 1, { query: "Yuki" });
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows.map((r) => r[0]).sort()).toEqual(["Yuki Tanaka", "Yuki Yamamoto"].sort());
    expect((result.links ?? []).slice().sort()).toEqual(
      [`/customers/${a.id}/edit`, `/customers/${b.id}/edit`].sort(),
    );
  });
});

describe("recent_activity", () => {
  it("windows by days, caps at 15, and excludes org-999 events", async () => {
    for (let i = 0; i < 18; i++) {
      await insertActivity({ summary: `recent-${i}`, createdAt: new Date(Date.now() - i * 1000) });
    }
    await insertActivity({ summary: "too-old", createdAt: new Date(Date.now() - 40 * 86_400_000) });
    await insertActivity({ orgId: 999, summary: "foreign-event", createdAt: new Date() });

    const result = await COMMANDS.recent_activity.run(db, 1, { days: 7 });
    expect(result.kind).toBe("list");
    if (result.kind !== "list") throw new Error("unreachable");
    expect(result.items).toHaveLength(15);
    expect(result.items.some((i) => i.text.includes("too-old"))).toBe(false);
    expect(result.items.some((i) => i.text.includes("foreign-event"))).toBe(false);
  });

  it("a narrower days window excludes events outside it", async () => {
    await insertActivity({ summary: "three-days-old", createdAt: new Date(Date.now() - 3 * 86_400_000) });
    const result = await COMMANDS.recent_activity.run(db, 1, { days: 1 });
    if (result.kind !== "list") throw new Error("unreachable");
    expect(result.items.some((i) => i.text.includes("three-days-old"))).toBe(false);
  });
});

describe("revenue_trend", () => {
  it("labels months correctly and degrades gracefully ('—') where one side has no data for a month", async () => {
    await db.insert(schema.revenueMonths).values([
      { year: 2026, month: 6, amountCents: 100_00 },
      { year: 2026, month: 7, amountCents: 200_00 },
    ]);
    await db.insert(schema.profitMonths).values([{ year: 2026, month: 7, amountCents: 30_00 }]);

    const result = await COMMANDS.revenue_trend.run(db, 1, {});
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows).toEqual([
      ["2026-07", formatCentsExact(200_00), formatCentsExact(30_00)],
      ["2026-06", formatCentsExact(100_00), "—"],
    ]);
  });

  it("an empty legacy table degrades to a well-formed, empty table (never throws)", async () => {
    const result = await COMMANDS.revenue_trend.run(db, 1, {});
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows).toEqual([]);
  });
});

describe("unpaid_by_customer", () => {
  it("sums balances per customer, excludes fully-paid customers, and a wrong-org payment never deflates the total", async () => {
    const a = await insertCustomer({ name: "Customer A" });
    const inv1 = await insertInvoice({ customerId: a.id, totalCents: 10_000 });
    const inv2 = await insertInvoice({ customerId: a.id, totalCents: 5_000 });
    void inv2;
    await insertPayment({ invoiceId: inv1.id, amountCents: 2_000 });
    // Adversarial payment: org_id disagrees with the invoice's real owner —
    // the org-scoped payments subquery must key off payments.org_id, so this
    // must NOT deflate org 1's balance (same trick as test/db/runway.test.ts).
    await insertPayment({ orgId: 999, invoiceId: inv1.id, amountCents: 999_999 });

    const paidOff = await insertCustomer({ name: "Paid Off" });
    const inv3 = await insertInvoice({ customerId: paidOff.id, totalCents: 3_000 });
    await insertPayment({ invoiceId: inv3.id, amountCents: 3_000 });

    const c999 = await insertCustomer({ orgId: 999, name: "Foreign Unpaid" });
    await insertInvoice({ orgId: 999, customerId: c999.id, totalCents: 77_700 });

    const result = await COMMANDS.unpaid_by_customer.run(db, 1, {});
    expect(result.kind).toBe("table");
    if (result.kind !== "table") throw new Error("unreachable");
    expect(result.rows).toEqual([["Customer A", formatCentsExact(13_000)]]); // (10000-2000)+5000
    expect(result.links).toEqual([`/customers/${a.id}/edit`]);
  });
});

describe("demo mode — every command returns a well-formed result", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sweeps all 8 commands against demo seed data", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    // Demo's only receivable (invoice 9302) carries 30-day terms from an
    // issue date 9 days ago (src/lib/demo/seed.ts) — its due date is still
    // 21 days away, so by real-clock terms it is NOT currently overdue. An
    // empty, well-formed table is the honest answer; receivables_summary
    // and unpaid_by_customer below are what surface 9302's balance
    // regardless of due-date (flagged for the 35a-2 router: the spec's own
    // "who owes me money" example phrase belongs to overdue_invoices, which
    // in demo mode currently yields nothing).
    const overdue = await COMMANDS.overdue_invoices.run(db, 1, { minDays: 1 });
    expect(overdue.kind).toBe("table");
    if (overdue.kind === "table") expect(overdue.rows).toEqual([]);

    const summary = await COMMANDS.receivables_summary.run(db, 1, {});
    expect(summary.kind).toBe("stat");
    if (summary.kind === "stat") expect(summary.value).not.toBe(formatCentsExact(0)); // 9302's balance

    const runway = await COMMANDS.runway.run(db, 1, {});
    expect(runway.kind).toBe("stat");
    if (runway.kind === "stat") expect(runway.value.length).toBeGreaterThan(0);

    // Demo seed carries only "watch"/"healthy" bands (see DEMO_HEALTH_SNAPSHOTS)
    // — zero "at_risk" customers. An empty-but-well-formed table is the
    // correct, honest answer, not a bug (test/lib/investor/collect.test.ts's
    // demo test locks the same { at_risk: 0 } fact for collectInvestorKpis).
    const atRisk = await COMMANDS.at_risk_customers.run(db, 1, { band: "at_risk" });
    expect(atRisk.kind).toBe("table");
    if (atRisk.kind === "table") expect(atRisk.rows).toEqual([]);
    const watch = await COMMANDS.at_risk_customers.run(db, 1, { band: "watch" });
    if (watch.kind === "table") expect(watch.rows.length).toBeGreaterThan(0);

    const lookup = await COMMANDS.customer_lookup.run(db, 1, { query: "Mehta" });
    expect(lookup.kind).toBe("list");

    const activity = await COMMANDS.recent_activity.run(db, 1, { days: 7 });
    expect(activity.kind).toBe("list");
    if (activity.kind === "list") expect(activity.items.length).toBeGreaterThan(0);

    // Legacy revenue_months/profit_months carry NO demo branch by design
    // (src/lib/investor/collect.ts's honesty comment) — the ephemeral demo
    // pglite never receives this data, so an empty table is the graceful,
    // well-formed degradation, not a bug.
    const revenue = await COMMANDS.revenue_trend.run(db, 1, {});
    expect(revenue.kind).toBe("table");
    if (revenue.kind === "table") expect(revenue.rows).toEqual([]);

    const unpaid = await COMMANDS.unpaid_by_customer.run(db, 1, {});
    expect(unpaid.kind).toBe("table");
    if (unpaid.kind === "table") expect(unpaid.rows.length).toBeGreaterThan(0); // Tanaka's balance
  });
});
