import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TodaysBidsPanel } from "@/components/dashboard/TodaysBidsPanel";
import type { TodaysBidView } from "@/db/bids";

const noopActions = {
  acceptBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
};

function row(over: Partial<TodaysBidView>): TodaysBidView {
  return {
    bidId: 1, dealId: 100, dealSubject: "1.02ct G/VS1 round",
    bidderOrgLabel: "Mehta", priceCents: 12_300_00, currency: "USD",
    createdAt: new Date(), ...over,
  };
}

describe("TodaysBidsPanel", () => {
  it("renders empty state when there are no bids", () => {
    render(<TodaysBidsPanel bids={[]} actions={noopActions} />);
    expect(screen.getByText(/no bids today yet/i)).toBeInTheDocument();
  });

  it("renders one row per incoming bid", () => {
    render(<TodaysBidsPanel
      bids={[row({ bidId: 1 }), row({ bidId: 2, bidderOrgLabel: "Saint-Cloud", priceCents: 89_500_00 })]}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("todays bid row")).toHaveLength(2);
    expect(screen.getByText(/Mehta/)).toBeInTheDocument();
    expect(screen.getByText(/Saint-Cloud/)).toBeInTheDocument();
  });

  it("Accept button click fires acceptBid", async () => {
    const actions = { ...noopActions, acceptBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysBidsPanel bids={[row({ bidId: 42 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/accept bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Reject button click fires rejectBid", async () => {
    const actions = { ...noopActions, rejectBid: vi.fn(async () => ({ ok: true as const })) };
    render(<TodaysBidsPanel bids={[row({ bidId: 99 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/reject bid 99/));
    await waitFor(() => expect(actions.rejectBid).toHaveBeenCalledWith({ bidId: 99 }));
  });

  it("truncates long deal subjects to 40 chars", () => {
    const longSubject = "A".repeat(60);
    render(<TodaysBidsPanel bids={[row({ dealSubject: longSubject })]} actions={noopActions} />);
    expect(screen.getByText(/A{39}…/)).toBeInTheDocument();
  });

  it("renders alert when Accept fails", async () => {
    const actions = {
      ...noopActions,
      acceptBid: vi.fn(async () => ({ ok: false as const, error: "Forbidden — not your deal" })),
    };
    render(<TodaysBidsPanel bids={[row({ bidId: 55 })]} actions={actions} />);
    fireEvent.click(screen.getByLabelText(/accept bid 55/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/forbidden/i);
  });
});
