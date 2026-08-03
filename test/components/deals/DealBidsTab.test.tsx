import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealBidsTab } from "@/components/deals/DealBidsTab";
import type { BidView } from "@/db/bids";

// Mirrors test/components/dashboard/WebsiteOverviewPanel.test.tsx's child-mock
// pattern: the coach card's own behavior (fetch/render states) is covered by
// test/components/deals/NegotiationCoachCard.test.tsx — this file only needs
// to verify DealBidsTab renders it (or not) with the right props, so a thin
// stub that surfaces its props as text is enough, and it keeps this file off
// the negotiation action's db/compute import graph.
vi.mock("@/components/deals/NegotiationCoachCard", () => ({
  NegotiationCoachCard: (props: { dealId: number; leadBidderOrgId: number; leadBidderLabel: string }) => (
    <div data-testid="negotiation-coach-card">
      {props.dealId}:{props.leadBidderOrgId}:{props.leadBidderLabel}
    </div>
  ),
}));

const noopActions = {
  postBid: vi.fn(async (_i: { dealId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
  acceptBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  withdrawBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  setBidMode: vi.fn(async (_i: { dealId: number; mode: "single" | "history" }) => ({ ok: true as const })),
};

function bid(over: Partial<BidView>): BidView {
  return {
    id: 1, dealId: 1, bidderOrgId: 999, bidderOrgLabel: "Mehta",
    priceCents: 1_200_00, currency: "USD", notes: null,
    bidMode: "single", status: "pending", decidedAt: null, createdAt: new Date(),
    ...over,
  };
}

describe("DealBidsTab", () => {
  it("renders empty state with bid form for non-owner viewer", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByText(/no bids yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("bid price")).toBeInTheDocument();
  });

  it("HIDES the bid form when viewer is the deal owner", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText("bid price")).toBeNull();
  });

  it("renders mode selector only for the owner", () => {
    const { rerender } = render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByLabelText(/bid display mode/i)).toBeInTheDocument();
    rerender(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText(/bid display mode/i)).toBeNull();
  });

  it("single mode shows latest pending per bidder; hides earlier rows from same bidder", () => {
    const now = Date.now();
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[
        bid({ id: 2, priceCents: 1_300_00, createdAt: new Date(now) }),
        bid({ id: 1, priceCents: 1_100_00, createdAt: new Date(now - 60000) }),
      ]}
      actions={noopActions}
    />);
    const rows = screen.getAllByLabelText("bid row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("$1,300.00");
  });

  it("history mode shows all bids chronologically", () => {
    const now = Date.now();
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="history" dealKind="SELL"
      bids={[
        bid({ id: 2, priceCents: 1_300_00, createdAt: new Date(now) }),
        bid({ id: 1, priceCents: 1_100_00, createdAt: new Date(now - 60000) }),
      ]}
      actions={noopActions}
    />);
    expect(screen.getAllByLabelText("bid row")).toHaveLength(2);
  });

  it("Accept button click fires acceptBid", async () => {
    const actions = { ...noopActions, acceptBid: vi.fn(async () => ({ ok: true as const })) };
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[bid({ id: 42 })]} actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Withdraw button only appears on bidder's own pending bid", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[bid({ id: 1, bidderOrgId: 999 })]} actions={noopActions}
    />);
    expect(screen.getByLabelText(/withdraw bid 1/)).toBeInTheDocument();
  });

  it("PostBidForm submits parsed cents via postBid", async () => {
    const actions = {
      ...noopActions,
      postBid: vi.fn(async (_i: { dealId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
    };
    render(<DealBidsTab
      dealId={7} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[]} actions={actions}
    />);
    fireEvent.change(screen.getByLabelText("bid price"), { target: { value: "123.45" } });
    fireEvent.click(screen.getByLabelText(/submit bid/));
    await waitFor(() => expect(actions.postBid).toHaveBeenCalledTimes(1));
    expect(actions.postBid.mock.calls[0][0]).toEqual({
      dealId: 7,
      priceCents: 12345,
      currency: "USD",
      notes: undefined,
    });
  });

  it("XSS sanity: notes with HTML render as text, not executed markup", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[bid({ notes: "<script>alert(1)</script>" })]} actions={noopActions}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("clears price + notes on successful post", async () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[]} actions={noopActions}
    />);
    const priceInput = screen.getByLabelText("bid price") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "200.00" } });
    expect(priceInput.value).toBe("200.00");
    fireEvent.click(screen.getByLabelText(/submit bid/));
    await waitFor(() => expect(priceInput.value).toBe(""));
  });

  it("renders alert on post failure", async () => {
    const actions = {
      ...noopActions,
      postBid: vi.fn(async () => ({ ok: false as const, error: "Demo mode — try again later" })),
    };
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[]} actions={actions}
    />);
    fireEvent.change(screen.getByLabelText("bid price"), { target: { value: "300.00" } });
    fireEvent.click(screen.getByLabelText(/submit bid/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/demo/i);
  });

  it("renders alert when Accept fails", async () => {
    const actions = {
      ...noopActions,
      acceptBid: vi.fn(async () => ({ ok: false as const, error: "Forbidden" })),
    };
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[bid({ id: 7 })]} actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 7/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/forbidden/i);
  });
});

describe("DealBidsTab — negotiation coach card (slice 42-3)", () => {
  it("shows the coach card for the owner when a pending bid exists", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[bid({ id: 1, bidderOrgId: 501, bidderOrgLabel: "Alpha" })]}
      actions={noopActions}
    />);
    expect(screen.getByTestId("negotiation-coach-card")).toBeInTheDocument();
  });

  it("hides the coach card for a non-owner", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null} dealKind="SELL"
      bids={[bid({ id: 1, bidderOrgId: 999 })]}
      actions={noopActions}
    />);
    expect(screen.queryByTestId("negotiation-coach-card")).toBeNull();
  });

  it("hides the coach card when there are no pending bids", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={[bid({ id: 1, status: "accepted", decidedAt: new Date() })]}
      actions={noopActions}
    />);
    expect(screen.queryByTestId("negotiation-coach-card")).toBeNull();
  });

  it("picks the kind-aware leader: highest price wins for SELL, lowest wins for BUY", () => {
    const bids = [
      bid({ id: 1, bidderOrgId: 501, bidderOrgLabel: "Alpha", priceCents: 100_000 }),
      bid({ id: 2, bidderOrgId: 502, bidderOrgLabel: "Beta", priceCents: 150_000 }),
    ];
    const { rerender } = render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="SELL"
      bids={bids} actions={noopActions}
    />);
    // SELL: the owner wants the highest price — Beta (150,000) leads.
    expect(screen.getByTestId("negotiation-coach-card")).toHaveTextContent("1:502:Beta");

    rerender(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single" dealKind="BUY"
      bids={bids} actions={noopActions}
    />);
    // BUY: the owner wants the lowest price — Alpha (100,000) leads.
    expect(screen.getByTestId("negotiation-coach-card")).toHaveTextContent("1:501:Alpha");
  });
});
