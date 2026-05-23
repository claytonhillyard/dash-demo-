// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/client";
import { revenueMonths, profitMonths, clients, employees } from "@/db/schema";
import { readCompanyDashboard } from "@/db/dashboard";

describe("readCompanyDashboard", () => {
  it("returns zeroed KPIs and empty series for a fresh db", async () => {
    const { db, close } = await createTestDb();
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.kpis.revenueCents).toBe(0);
    expect(out.kpis.profitCents).toBe(0);
    expect(out.kpis.marginPct).toBeNull();
    expect(out.kpis.activeClients).toBe(0);
    expect(out.kpis.totalClients).toBe(0);
    expect(out.kpis.employees).toBe(0);
    expect(out.series).toHaveLength(12);
    expect(out.projection).toBeNull();
    expect(out.hasAnyData).toBe(false);
    await close();
  });

  it("assembles real KPIs when data exists", async () => {
    const { db, close } = await createTestDb();
    await db.insert(revenueMonths).values({ year: 2026, month: 4, amountCents: 100_00 });
    await db.insert(profitMonths).values({ year: 2026, month: 4, amountCents: 25_00 });
    await db.insert(clients).values({ name: "A", status: "active", valueCents: 0, acquiredOn: "2026-01-01" });
    await db.insert(employees).values({ name: "E", role: "eng", hiredOn: "2025-01-01" });
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.kpis.revenueCents).toBe(100_00);
    expect(out.kpis.marginPct).toBe(25);
    expect(out.kpis.activeClients).toBe(1);
    expect(out.kpis.employees).toBe(1);
    expect(out.hasAnyData).toBe(true);
    await close();
  });
});
