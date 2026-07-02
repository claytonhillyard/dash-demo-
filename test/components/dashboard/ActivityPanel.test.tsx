import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityPanel } from "@/components/dashboard/ActivityPanel";
import type { ActivityEvent } from "@/lib/activity/types";

const EV: ActivityEvent = {
  id: 1, orgId: 1, actor: "owner@aiya.demo", entityType: "customer",
  entityId: 2201, verb: "created", summary: "Added Priya Mehta",
  payload: null, createdAt: new Date(),
};

describe("ActivityPanel", () => {
  it("renders events and the View all link", () => {
    render(<ActivityPanel events={[EV]} />);
    expect(screen.getByText("Recent Activity")).toBeInTheDocument();
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/activity");
  });

  it("renders the empty state when no events", () => {
    render(<ActivityPanel events={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });
});
