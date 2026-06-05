import { describe, it, expect } from "vitest";
import { formatSessionDuration, weekOverWeekDelta } from "@/lib/website/format";

describe("formatSessionDuration", () => {
  it("formats 0 seconds as 0:00", () => {
    expect(formatSessionDuration(0)).toBe("0:00");
  });

  it("formats < 60 seconds with a leading 0:", () => {
    expect(formatSessionDuration(59)).toBe("0:59");
  });

  it("formats exactly 60 seconds as 1:00", () => {
    expect(formatSessionDuration(60)).toBe("1:00");
  });

  it("formats 3:30", () => {
    expect(formatSessionDuration(210)).toBe("3:30");
  });

  it("formats exactly 1 hour as h:mm:ss", () => {
    expect(formatSessionDuration(3600)).toBe("1:00:00");
  });

  it("formats 1:01:01", () => {
    expect(formatSessionDuration(3661)).toBe("1:01:01");
  });

  it("returns em-dash for negative input", () => {
    expect(formatSessionDuration(-5)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatSessionDuration(NaN)).toBe("—");
    expect(formatSessionDuration(Infinity)).toBe("—");
  });
});

describe("weekOverWeekDelta", () => {
  it("returns up direction with rounded percent for visitor growth", () => {
    expect(weekOverWeekDelta(5500, 5000)).toEqual({ sign: "up", percent: 10 });
  });

  it("returns down direction for visitor decline", () => {
    expect(weekOverWeekDelta(4500, 5000)).toEqual({ sign: "down", percent: 10 });
  });

  it("returns flat for equal values", () => {
    expect(weekOverWeekDelta(5000, 5000)).toEqual({ sign: "flat", percent: 0 });
  });

  it("handles previous=0 with current>0 (explicit branch)", () => {
    expect(weekOverWeekDelta(100, 0)).toEqual({ sign: "up", percent: 100 });
  });

  it("handles previous=0 with current=0", () => {
    expect(weekOverWeekDelta(0, 0)).toEqual({ sign: "flat", percent: 0 });
  });

  it("returns null when previous is null", () => {
    expect(weekOverWeekDelta(5000, null)).toBeNull();
  });

  it("returns null when previous is undefined", () => {
    expect(weekOverWeekDelta(5000, undefined)).toBeNull();
  });

  it("rounds to one decimal place", () => {
    // 5050 / 5000 = 1.01 → +1.0% (rounded)
    expect(weekOverWeekDelta(5050, 5000)).toEqual({ sign: "up", percent: 1 });
    // 5077 / 5000 = 1.0154 → +1.5% (rounded)
    expect(weekOverWeekDelta(5077, 5000)).toEqual({ sign: "up", percent: 1.5 });
  });
});
