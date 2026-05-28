// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../helpers/shared-db";
import type { Db } from "@/db/client";
import { revenueMonths, profitMonths, clients, employees } from "@/db/schema";
import { readCompanyDashboard } from "@/db/dashboard";

describe("readCompanyDashboard", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getSharedDb();
  });
  beforeEach(() => resetSharedDb());
  afterAll(() => closeSharedDb());

  it("returns zeroed KPIs and empty series for a fresh db", async () => {
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
  });

  it("assembles real KPIs when data exists", async () => {
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
  });

  it("derives companyUpdatedAt from company-table writes, independent of the projection", async () => {
    // Company KPI data exists, but no projection has ever been saved.
    await db.insert(employees).values({ name: "E", role: "eng", hiredOn: "2025-01-01" });
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.projection).toBeNull();
    expect(out.companyUpdatedAt).toBeInstanceOf(Date);
  });

  it("returns null companyUpdatedAt when no company-table data exists", async () => {
    const out = await readCompanyDashboard(db, 2026, 4);
    expect(out.companyUpdatedAt).toBeNull();
  });
});
