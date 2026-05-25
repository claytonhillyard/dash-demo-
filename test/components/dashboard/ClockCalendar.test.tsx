import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";

beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2025-05-08T10:45:00")));
afterEach(() => vi.useRealTimers());

describe("ClockCalendar", () => {
  it("renders the current time and the month grid", () => {
    render(<ClockCalendar />);
    expect(screen.getByTestId("clock").textContent).toMatch(/10:45/);
    expect(screen.getByText(/MAY 2025/i)).toBeInTheDocument();
    // Day 8 is present in the grid.
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});
