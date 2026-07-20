import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityList } from "@/components/activity/ActivityList";
import type { ActivityEvent } from "@/lib/activity/types";

function ev(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: 1, orgId: 1, actor: "owner@aiya.demo", entityType: "customer",
    entityId: 2201, verb: "created", summary: "Added Priya Mehta",
    payload: null, createdAt: new Date(Date.now() - 60_000),
    ...overrides,
  };
}

describe("ActivityList", () => {
  it("renders summary, actor, and relative time per row", () => {
    render(<ActivityList events={[ev({})]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    expect(screen.getByText("owner@aiya.demo")).toBeInTheDocument();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
  });

  it("hides actor in compact mode", () => {
    render(<ActivityList compact events={[ev({})]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
    expect(screen.queryByText("owner@aiya.demo")).not.toBeInTheDocument();
  });

  it("maps verb to a dot color class", () => {
    const { container } = render(
      <ActivityList events={[
        ev({ id: 1, verb: "created" }),
        ev({ id: 2, verb: "deleted", summary: "Deleted X" }),
        ev({ id: 3, verb: "bid_placed", summary: "Placed bid on Y" }),
        ev({ id: 4, verb: "health_dropped", summary: "Health dropped: Priya Mehta healthy → watch" }),
        ev({ id: 5, verb: "issued", summary: "Issued invoice INV-2026-0001" }),
        ev({ id: 6, verb: "voided", summary: "Voided invoice INV-2026-0001" }),
        ev({ id: 7, verb: "sent", summary: "Sent invoice INV-2026-0001 to Yuki Tanaka" }),
      ]} />,
    );
    const dots = container.querySelectorAll("[data-verb-dot]");
    expect(dots).toHaveLength(7);
    expect(dots[0].className).toContain("bg-emerald");
    expect(dots[1].className).toContain("bg-rose");
    expect(dots[2].className).toContain("bg-sky");
    expect(dots[3].className).toContain("bg-rose");
    expect(dots[4].className).toContain("bg-emerald");
    expect(dots[5].className).toContain("bg-rose");
    expect(dots[6].className).toContain("bg-sky");
  });

  it("renders the empty state when there are no events", () => {
    render(<ActivityList events={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("renders a null actor row without crashing (system event)", () => {
    render(<ActivityList events={[ev({ actor: null })]} />);
    expect(screen.getByText("Added Priya Mehta")).toBeInTheDocument();
  });
});
