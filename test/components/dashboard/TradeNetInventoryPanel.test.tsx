import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeNetInventoryPanel } from "@/components/dashboard/TradeNetInventoryPanel";

describe("TradeNetInventoryPanel", () => {
  it("renders the honest empty state when items is empty", () => {
    render(<TradeNetInventoryPanel items={[]} />);
    expect(screen.getByText(/No partner inventory shared with you yet/i)).toBeInTheDocument();
  });

  it("renders one row per item with name, qty, ownerOrgLabel", () => {
    render(<TradeNetInventoryPanel items={[
      {
        id: 1, orgId: 501, ownerOrgLabel: "Mehta Diamonds — Mumbai",
        category: "Diamonds", name: "Round 2.51ct E/VVS1 — demo",
        quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date(),
      },
    ]} />);
    expect(screen.getByText(/Round 2.51ct/)).toBeInTheDocument();
    expect(screen.getByText(/Mehta Diamonds/)).toBeInTheDocument();
  });

  it("XSS guard: ownerOrgLabel is rendered as text, not HTML", () => {
    const xss = "<script>alert(1)</script>";
    render(<TradeNetInventoryPanel items={[
      { id: 1, orgId: 501, ownerOrgLabel: xss, category: "Diamonds",
        name: "demo", quantity: 1, status: "in_stock", visibilityCircleId: 201,
        updatedAt: new Date() },
    ]} />);
    expect(screen.getByText(xss)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
