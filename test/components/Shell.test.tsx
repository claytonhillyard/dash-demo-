import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "@/components/dashboard/Shell";

describe("Shell", () => {
  it("renders nav, wordmark, and a content slot", () => {
    render(<Shell><div data-testid="slot">x</div></Shell>);
    expect(screen.getByText("CHILLY.AI")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByTestId("slot")).toBeInTheDocument();
  });
});
