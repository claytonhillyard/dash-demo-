import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InventoryOverviewPanel } from "@/components/dashboard/InventoryOverviewPanel";

const counts = {
  Rings: 1240, Necklaces: 980, Earrings: 870, Bracelets: 620, Pendants: 450,
  Chains: 320, "Watch Bands": 150, Diamonds: 2350, Gems: 1120,
};

it("renders a tile per category with its count, plus the total and provenance", () => {
  render(<InventoryOverviewPanel counts={counts} total={8100} updatedLabel="updated today" />);
  const rings = screen.getByTestId("inv-tile-Rings");
  expect(within(rings).getByText("Rings")).toBeInTheDocument();
  expect(within(rings).getByText("1,240")).toBeInTheDocument();
  expect(screen.getByText(/8,100/)).toBeInTheDocument();
  expect(screen.getByText(/updated today/)).toBeInTheDocument();
});

it("renders an honest empty state when there is no inventory", () => {
  const zero = {
    Rings: 0, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
    Chains: 0, "Watch Bands": 0, Diamonds: 0, Gems: 0,
  };
  render(<InventoryOverviewPanel counts={zero} total={0} updatedLabel={null} />);
  expect(screen.getByText(/no inventory yet/i)).toBeInTheDocument();
});
