import { describe, it, expect } from "vitest";
import { formatCents, updatedAgo } from "@/lib/company/format";

describe("formatCents", () => {
  it("formats integer cents as USD whole dollars", () => {
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(100_00)).toBe("$100");
    expect(formatCents(1_234_56)).toBe("$1,235"); // rounded to whole dollars
  });
  it("renders an em dash for null/undefined", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
  });
});

describe("updatedAgo", () => {
  const now = new Date("2026-05-23T12:00:00Z").getTime();
  it("says 'updated today' for same-day", () => {
    expect(updatedAgo(new Date("2026-05-23T01:00:00Z"), now)).toBe("updated today");
  });
  it("counts whole days", () => {
    expect(updatedAgo(new Date("2026-05-21T12:00:00Z"), now)).toBe("updated 2d ago");
  });
  it("returns null when no date", () => {
    expect(updatedAgo(null, now)).toBeNull();
  });
});
