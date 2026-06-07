import { describe, it, expect } from "vitest";
import {
  postInventoryBidInput,
  acceptInventoryBidInput,
  setInventoryItemBidModeInput,
} from "@/lib/inventory/bidValidation";

describe("postInventoryBidInput", () => {
  it("accepts valid input", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 100 }).success).toBe(true);
  });
  it("rejects zero or negative prices", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 0 }).success).toBe(false);
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: -1 }).success).toBe(false);
  });
  it("rejects notes > 500 chars", () => {
    expect(
      postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 1, notes: "x".repeat(501) }).success,
    ).toBe(false);
  });
  it("rejects unknown currency", () => {
    expect(
      postInventoryBidInput.safeParse({ inventoryItemId: 1, priceCents: 1, currency: "AUD" }).success,
    ).toBe(false);
  });
  it("rejects zero inventoryItemId", () => {
    expect(postInventoryBidInput.safeParse({ inventoryItemId: 0, priceCents: 1 }).success).toBe(false);
  });
});

describe("acceptInventoryBidInput", () => {
  it("accepts positive bidId", () => {
    expect(acceptInventoryBidInput.safeParse({ bidId: 7 }).success).toBe(true);
  });
});

describe("setInventoryItemBidModeInput", () => {
  it("accepts null mode (disable bidding)", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: null }).success).toBe(true);
  });
  it("accepts 'single' and 'history'", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "single" }).success).toBe(true);
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "history" }).success).toBe(true);
  });
  it("rejects bogus mode strings", () => {
    expect(setInventoryItemBidModeInput.safeParse({ inventoryItemId: 1, mode: "off" }).success).toBe(false);
  });
});
