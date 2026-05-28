import { describe, it, expect } from "vitest";
import { formatCents, updatedAgo, timeAgo } from "@/lib/company/format";

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

describe("timeAgo", () => {
  const now = new Date("2026-05-28T12:00:00Z").getTime();

  it("'just now' for < 60 seconds", () => {
    expect(timeAgo(new Date(now - 30_000), now)).toBe("just now");
  });
  it("minutes for 1m..59m", () => {
    expect(timeAgo(new Date(now - 15 * 60_000), now)).toBe("15m ago");
  });
  it("hours for 1h..23h", () => {
    expect(timeAgo(new Date(now - 3 * 3_600_000), now)).toBe("3h ago");
  });
  it("days for 1d..6d", () => {
    expect(timeAgo(new Date(now - 2 * 86_400_000), now)).toBe("2d ago");
  });
  it("short date for >= 7 days", () => {
    const result = timeAgo(new Date(now - 8 * 86_400_000), now);
    expect(result).toMatch(/[A-Z][a-z]{2} \d+/); // e.g. "May 20"
  });
});
