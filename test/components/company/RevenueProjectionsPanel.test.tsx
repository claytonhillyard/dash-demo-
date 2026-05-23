import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RevenueProjectionsPanel } from "@/components/company/RevenueProjectionsPanel";

describe("RevenueProjectionsPanel", () => {
  it("renders an empty CTA when there is no projection", () => {
    render(<RevenueProjectionsPanel projection={null} updatedLabel={null} />);
    expect(screen.getByText(/set a projection/i)).toBeInTheDocument();
  });

  it("renders the projected end-year value and provenance when present", () => {
    render(
      <RevenueProjectionsPanel
        projection={{
          points: [
            { year: 2026, amountCents: 100_00 },
            { year: 2027, amountCents: 110_00 },
            { year: 2028, amountCents: 121_00 },
            { year: 2029, amountCents: 133_10 },
            { year: 2030, amountCents: 146_41 },
          ],
          updatedAt: new Date("2026-05-20T00:00:00Z"),
        }}
        updatedLabel="updated 3d ago"
      />
    );
    expect(screen.getByText(/2030/)).toBeInTheDocument();
    expect(screen.getByText("updated 3d ago")).toBeInTheDocument();
  });
});
