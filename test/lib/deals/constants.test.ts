import { describe, it, expect } from "vitest";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES } from "@/lib/deals/constants";

describe("deal constants", () => {
  it("exports the BUY/SELL kinds", () => {
    expect(DEAL_KINDS).toEqual(["BUY", "SELL"]);
  });
  it("exports the five categories", () => {
    expect(DEAL_CATEGORIES).toEqual(["Diamond", "Gem", "Metal", "Finished", "Other"]);
  });
  it("exports the three statuses", () => {
    expect(DEAL_STATUSES).toEqual(["Open", "Filled", "Withdrawn"]);
  });
});
