import { describe, it, expect } from "vitest";
import { postDealInput, updateDealStatusInput, firstZodError } from "@/lib/deals/validation";

describe("postDealInput", () => {
  it("accepts a valid SELL Diamond deal", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Diamond",
      subject: "Round 1.02ct G/VS1",
      quantity: 1, priceCents: 1240000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a valid BUY Metal deal", () => {
    const r = postDealInput.safeParse({
      kind: "BUY", category: "Metal",
      subject: "18K gold chain lot, 10g per link",
      quantity: 5, priceCents: 875000,
    });
    expect(r.success).toBe(true);
  });

  it("trims leading/trailing whitespace from subject", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other",
      subject: "  loose pearls  ",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.subject).toBe("loose pearls");
  });

  it("rejects an empty subject", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstZodError(r.error)).toMatch(/subject/);
  });

  it("rejects a subject over 280 chars", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other",
      subject: "x".repeat(281),
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative price", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer price", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: 100.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects zero quantity", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 0, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const r = postDealInput.safeParse({
      kind: "TRADE", category: "Other", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const r = postDealInput.safeParse({
      kind: "BUY", category: "Spaceships", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(false);
  });

  it("defaults currency to USD when omitted", () => {
    const r = postDealInput.safeParse({
      kind: "SELL", category: "Other", subject: "x",
      quantity: 1, priceCents: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USD");
  });
});

describe("updateDealStatusInput", () => {
  it("accepts Filled", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Filled" }).success).toBe(true);
  });
  it("accepts Withdrawn", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Withdrawn" }).success).toBe(true);
  });
  it("rejects Open (terminal-only update target)", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Open" }).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(updateDealStatusInput.safeParse({ id: 1, status: "Reopened" }).success).toBe(false);
  });
});
