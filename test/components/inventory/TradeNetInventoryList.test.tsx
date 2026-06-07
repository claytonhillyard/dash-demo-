import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeNetInventoryList } from "@/components/inventory/TradeNetInventoryList";

function makeItem(overrides: Partial<Parameters<typeof TradeNetInventoryList>[0]["items"][number]> = {}) {
  return {
    id: 1, orgId: 999, ownerOrgLabel: "Mehta", category: "Diamonds" as const,
    name: "x", quantity: 1, status: "in_stock" as const, visibilityCircleId: 201,
    bidMode: "single" as const, updatedAt: new Date(),
    ...overrides,
  };
}

describe("TradeNetInventoryList — Place Bid button visibility", () => {
  it("shows the button when bidMode !== null AND viewer !== owner", () => {
    render(<TradeNetInventoryList
      items={[makeItem()]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: /Place Bid/i })).toBeInTheDocument();
  });

  it("hides the button when viewer === owner (self-bid UX guard)", () => {
    render(<TradeNetInventoryList
      items={[makeItem({ orgId: 1 })]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.queryByRole("button", { name: /Place Bid/i })).not.toBeInTheDocument();
  });

  it("hides the button when bidMode === null", () => {
    render(<TradeNetInventoryList
      items={[makeItem({ bidMode: null })]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={new Map()}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.queryByRole("button", { name: /Place Bid/i })).not.toBeInTheDocument();
  });

  it("shows pending count when bidsByItemId has pending entries", () => {
    const bids = new Map([[1, [
      { id: 10, inventoryItemId: 1, bidderOrgId: 1, bidderOrgLabel: "AIYA", priceCents: 1, currency: "USD", notes: null, quantityRequested: 1, status: "pending" as const, decidedAt: null, createdAt: new Date() },
      { id: 11, inventoryItemId: 1, bidderOrgId: 1, bidderOrgLabel: "AIYA", priceCents: 1, currency: "USD", notes: null, quantityRequested: 1, status: "pending" as const, decidedAt: null, createdAt: new Date() },
    ]]]);
    render(<TradeNetInventoryList
      items={[makeItem()]}
      circleNamesById={new Map([[201, "Trusted"]])}
      viewerOrgId={1}
      bidsByItemId={bids}
      onPlaceBid={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: /Place Bid · 2 pending/i })).toBeInTheDocument();
  });
});
