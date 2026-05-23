import { describe, it, expect } from "vitest";
import {
  revenueMonthInput,
  revenueTransactionInput,
  profitMonthInput,
  clientInput,
  employeeInput,
  projectionInput,
} from "@/lib/company/validation";

describe("company validation", () => {
  it("accepts a valid revenue month", () => {
    const r = revenueMonthInput.safeParse({ year: 2026, month: 4, amountCents: 100_00 });
    expect(r.success).toBe(true);
  });
  it("rejects month out of 1..12", () => {
    expect(revenueMonthInput.safeParse({ year: 2026, month: 13, amountCents: 1 }).success).toBe(false);
    expect(revenueMonthInput.safeParse({ year: 2026, month: 0, amountCents: 1 }).success).toBe(false);
  });
  it("rejects non-integer cents", () => {
    expect(revenueMonthInput.safeParse({ year: 2026, month: 4, amountCents: 1.5 }).success).toBe(false);
  });
  it("requires a memo-optional transaction with an ISO date", () => {
    expect(
      revenueTransactionInput.safeParse({ occurredOn: "2026-04-01", amountCents: 5_00 }).success
    ).toBe(true);
    expect(
      revenueTransactionInput.safeParse({ occurredOn: "nope", amountCents: 5_00 }).success
    ).toBe(false);
  });
  it("validates profit month like revenue month", () => {
    expect(profitMonthInput.safeParse({ year: 2026, month: 4, amountCents: -5_00 }).success).toBe(true);
  });
  it("requires a client name and a valid status + acquiredOn", () => {
    expect(
      clientInput.safeParse({ name: "Acme", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(true);
    expect(
      clientInput.safeParse({ name: "", status: "active", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(false);
    expect(
      clientInput.safeParse({ name: "Acme", status: "lead", valueCents: 0, acquiredOn: "2026-01-01" })
        .success
    ).toBe(false);
  });
  it("requires employee name, role, hiredOn", () => {
    expect(employeeInput.safeParse({ name: "E", role: "eng", hiredOn: "2025-01-01" }).success).toBe(true);
    expect(employeeInput.safeParse({ name: "E", role: "", hiredOn: "2025-01-01" }).success).toBe(false);
  });
  it("validates a projection assumptions input incl. per-year overrides", () => {
    expect(
      projectionInput.safeParse({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: { "2028": 200_00 },
      }).success
    ).toBe(true);
    expect(
      projectionInput.safeParse({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: { "2028": 1.5 },
      }).success
    ).toBe(false);
  });
});
