import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealBidsTab } from "@/components/deals/DealBidsTab";
import type { BidView } from "@/db/bids";

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
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByText(/no bids yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("bid price")).toBeInTheDocument();
  });

  it("HIDES the bid form when viewer is the deal owner", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText("bid price")).toBeNull();
  });

  it("renders mode selector only for the owner", () => {
    const { rerender } = render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[]} actions={noopActions}
    />);
    expect(screen.getByLabelText(/bid display mode/i)).toBeInTheDocument();
    rerender(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
      bids={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText(/bid display mode/i)).toBeNull();
  });

  it("single mode shows latest pending per bidder; hides earlier rows from same bidder", () => {
    const now = Date.now();
    render(<DealBidsTab
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
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
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="history"
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
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[bid({ id: 42 })]} actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 42/));
    await waitFor(() => expect(actions.acceptBid).toHaveBeenCalledWith({ bidId: 42 }));
  });

  it("Withdraw button only appears on bidder's own pending bid", () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
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
      dealId={7} viewerOrgId={999} isOwner={false} currentBidMode={null}
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
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[bid({ notes: "<script>alert(1)</script>" })]} actions={noopActions}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("clears price + notes on successful post", async () => {
    render(<DealBidsTab
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
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
      dealId={1} viewerOrgId={999} isOwner={false} currentBidMode={null}
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
      dealId={1} viewerOrgId={1} isOwner={true} currentBidMode="single"
      bids={[bid({ id: 7 })]} actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 7/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/forbidden/i);
  });
});
