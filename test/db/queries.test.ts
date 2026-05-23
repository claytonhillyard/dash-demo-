// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import {
  revenueMonths,
  revenueTransactions,
  profitMonths,
  clients,
  employees,
  projectionAssumptions,
} from "@/db/schema";
import {
  getCurrentMonthRevenueCents,
  getCurrentMonthProfitCents,
  getCurrentOperatingMarginPct,
  getClientCounts,
  getEmployeeCount,
  getTrailingTwelveMonths,
  getProjection,
} from "@/db/queries";

const Y = 2026;
const M = 4; // a fixed "current" month for deterministic tests

describe("queries against pglite", () => {
  it("current revenue: transactions override the manual bucket (precedence)", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 999_00 });
    await db.insert(revenueTransactions).values([
      { occurredOn: "2026-04-03", amountCents: 10_00, memo: "deal a" },
      { occurredOn: "2026-04-20", amountCents: 25_00, memo: "deal b" },
    ]);
    expect(await getCurrentMonthRevenueCents(db, Y, M)).toBe(35_00);
    await close();
  });

  it("current revenue: falls back to the manual bucket when no transactions", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 250_00 });
    expect(await getCurrentMonthRevenueCents(db, Y, M)).toBe(250_00);
    await close();
  });

  it("profit + margin for the current month, with divide-by-zero guard", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 100_00 });
    await db.insert(profitMonths).values({ year: Y, month: M, amountCents: 25_00 });
    expect(await getCurrentMonthProfitCents(db, Y, M)).toBe(25_00);
    expect(await getCurrentOperatingMarginPct(db, Y, M)).toBe(25);

    const { db: db2, close: close2 } = await createTestDb();
    await db2.insert(profitMonths).values({ year: Y, month: M, amountCents: 25_00 });
    expect(await getCurrentOperatingMarginPct(db2, Y, M)).toBeNull(); // no revenue
    await close();
    await close2();
  });

  it("client counts: active count + total", async () => {
    const { db, close } = await createTestDb();
    await db.insert(clients).values([
      { name: "A", status: "active", valueCents: 0, acquiredOn: "2026-01-01" },
      { name: "B", status: "active", valueCents: 0, acquiredOn: "2026-02-01" },
      { name: "C", status: "prospect", valueCents: 0, acquiredOn: "2026-03-01" },
      { name: "D", status: "churned", valueCents: 0, acquiredOn: "2025-12-01" },
    ]);
    expect(await getClientCounts(db)).toEqual({ active: 2, total: 4 });
    await close();
  });

  it("employee count", async () => {
    const { db, close } = await createTestDb();
    await db.insert(employees).values([
      { name: "E1", role: "eng", hiredOn: "2025-01-01" },
      { name: "E2", role: "ops", hiredOn: "2026-01-01" },
    ]);
    expect(await getEmployeeCount(db)).toBe(2);
    await close();
  });

  it("trailing 12 months: revenue + profit + clients-added by acquired_on", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: Y, month: M, amountCents: 500_00 });
    await db.insert(profitMonths).values({ year: Y, month: M, amountCents: 120_00 });
    await db.insert(clients).values([
      { name: "X", status: "active", valueCents: 0, acquiredOn: "2026-04-10" },
      { name: "Y", status: "active", valueCents: 0, acquiredOn: "2026-04-22" },
    ]);
    const series = await getTrailingTwelveMonths(db, Y, M);
    expect(series).toHaveLength(12);
    const last = series[11];
    expect(last).toMatchObject({
      year: Y,
      month: M,
      revenueCents: 500_00,
      profitCents: 120_00,
      clientsAdded: 2,
    });
    const first = series[0];
    expect(first).toMatchObject({ revenueCents: 0, profitCents: 0, clientsAdded: 0 });
    await close();
  });

  it("projection: returns null when no assumptions row exists", async () => {
    const { db, close } = await createTestDb();
    expect(await getProjection(db)).toBeNull();
    await close();
  });

  it("projection: compounds from the singleton assumptions row with overrides", async () => {
    const { db, close } = await createTestDb();
    await db.insert(projectionAssumptions).values({
      baseYear: 2026,
      baseRevenueCents: 100_00,
      cagrPct: 10,
      perYearOverrides: { "2028": 200_00 },
    });
    const out = await getProjection(db);
    expect(out).not.toBeNull();
    expect(out!.points).toHaveLength(5);
    expect(out!.points[2]).toEqual({ year: 2028, amountCents: 200_00 });
    expect(out!.updatedAt).toBeInstanceOf(Date);
    await close();
  });
});
