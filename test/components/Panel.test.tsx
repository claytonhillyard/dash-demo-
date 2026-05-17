import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel } from "@/components/Panel";

describe("Panel", () => {
  it("renders title and children when ready", () => {
    render(<Panel title="Revenue" state="ready"><span>$23M</span></Panel>);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("$23M")).toBeInTheDocument();
  });

  it("shows a not-wired placeholder, never fake numbers", () => {
    render(<Panel title="Work Orders" state="unwired" />);
    expect(screen.getByText(/not yet wired/i)).toBeInTheDocument();
  });

  it("shows an error message in error state", () => {
    render(<Panel title="Crypto" state="error" errorMessage="boom" />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders a freshness dot when freshness given", () => {
    render(<Panel title="BTC" state="ready" freshness="simulated"><i/></Panel>);
    expect(screen.getByTestId("freshness-dot")).toHaveAttribute(
      "data-freshness", "simulated");
  });
});
