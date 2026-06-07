import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InventoryBidsTab } from "@/components/inventory/InventoryBidsTab";
import type { InventoryBidView } from "@/db/inventoryBids";

const noopActions = {
  postInventoryBid: vi.fn(async (_i: { inventoryItemId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
  acceptInventoryBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  rejectInventoryBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
  withdrawInventoryBid: vi.fn(async (_i: { bidId: number }) => ({ ok: true as const })),
};

function bid(over: Partial<InventoryBidView> = {}): InventoryBidView {
  return {
    id: 1,
    inventoryItemId: 601,
    bidderOrgId: 999,
    bidderOrgLabel: "Mehta",
    priceCents: 12_000_00,
    currency: "USD",
    notes: null,
    quantityRequested: 1,
    status: "pending",
    decidedAt: null,
    createdAt: new Date(),
    ...over,
  };
}

describe("InventoryBidsTab — state matrix", () => {
  it("renders bidding-disabled banner when bidMode === null", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: null }}
      viewerOrgId={999}
      bids={[]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByText(/Bidding is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("price")).not.toBeInTheDocument();
  });

  it("non-owner with no bids sees empty hint + form", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByText(/No bids yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText("price")).toBeInTheDocument();
  });

  it("owner sees ALL bids on item with accept/reject buttons (single mode)", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[
        bid({ id: 10, bidderOrgId: 999, bidderOrgLabel: "Mehta" }),
        bid({ id: 11, bidderOrgId: 888, bidderOrgLabel: "Saint-Cloud" }),
      ]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getAllByLabelText("bid row")).toHaveLength(2);
    expect(screen.getByLabelText(/accept bid 10/)).toBeInTheDocument();
    expect(screen.getByLabelText(/reject bid 11/)).toBeInTheDocument();
    expect(screen.queryByLabelText("price")).not.toBeInTheDocument();
  });

  it("owner sees all bids in history mode too (same rendering)", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "history" }}
      viewerOrgId={1}
      bids={[
        bid({ id: 20 }),
        bid({ id: 21 }),
      ]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getAllByLabelText("bid row")).toHaveLength(2);
  });

  it("bidder sees only their own bids (not other bidders' bids)", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[
        bid({ id: 30, bidderOrgId: 999, bidderOrgLabel: "Me" }),
        bid({ id: 31, bidderOrgId: 888, bidderOrgLabel: "Other" }),
      ]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    const rows = screen.getAllByLabelText("bid row");
    expect(rows).toHaveLength(1);
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("bidder sees Withdraw button only on their own pending bid", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[bid({ id: 40, bidderOrgId: 999, status: "pending" })]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByLabelText(/withdraw bid 40/)).toBeInTheDocument();
  });

  it("bidder does NOT see Withdraw on a non-pending bid", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[bid({ id: 41, bidderOrgId: 999, status: "accepted", decidedAt: new Date() })]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.queryByLabelText(/withdraw bid 41/)).not.toBeInTheDocument();
  });

  it("non-owner does NOT see Accept/Reject buttons", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[bid({ id: 50, bidderOrgId: 999 })]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.queryByLabelText(/accept bid 50/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reject bid 50/)).not.toBeInTheDocument();
  });

  it("Accept button fires acceptInventoryBid", async () => {
    const actions = { ...noopActions, acceptInventoryBid: vi.fn(async () => ({ ok: true as const })) };
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[bid({ id: 60 })]}
      actions={actions}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 60/));
    await waitFor(() => expect(actions.acceptInventoryBid).toHaveBeenCalledWith({ bidId: 60 }));
  });

  it("Reject button fires rejectInventoryBid", async () => {
    const actions = { ...noopActions, rejectInventoryBid: vi.fn(async () => ({ ok: true as const })) };
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[bid({ id: 61 })]}
      actions={actions}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByLabelText(/reject bid 61/));
    await waitFor(() => expect(actions.rejectInventoryBid).toHaveBeenCalledWith({ bidId: 61 }));
  });

  it("Withdraw button fires withdrawInventoryBid", async () => {
    const actions = { ...noopActions, withdrawInventoryBid: vi.fn(async () => ({ ok: true as const })) };
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[bid({ id: 62, bidderOrgId: 999 })]}
      actions={actions}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByLabelText(/withdraw bid 62/));
    await waitFor(() => expect(actions.withdrawInventoryBid).toHaveBeenCalledWith({ bidId: 62 }));
  });

  it("PostInventoryBidForm submits parsed cents via postInventoryBid", async () => {
    const actions = {
      ...noopActions,
      postInventoryBid: vi.fn(async (_i: { inventoryItemId: number; priceCents: number; currency?: string; notes?: string }) => ({ ok: true as const })),
    };
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[]}
      actions={actions}
      onClose={vi.fn()}
    />);
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "100.50" } });
    fireEvent.click(screen.getByRole("button", { name: /Place Bid/i }));
    await waitFor(() => expect(actions.postInventoryBid).toHaveBeenCalledTimes(1));
    expect(actions.postInventoryBid.mock.calls[0][0]).toEqual({
      inventoryItemId: 601,
      priceCents: 10050,
      currency: "USD",
      notes: undefined,
    });
  });

  it("renders status badges for non-pending bids (accepted/rejected/withdrawn/auto_rejected)", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "history" }}
      viewerOrgId={1}
      bids={[
        bid({ id: 71, status: "accepted", decidedAt: new Date() }),
        bid({ id: 72, status: "rejected", decidedAt: new Date() }),
        bid({ id: 73, status: "withdrawn", decidedAt: new Date() }),
        bid({ id: 74, status: "auto_rejected", decidedAt: new Date() }),
      ]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.getByText("withdrawn")).toBeInTheDocument();
    expect(screen.getByText("auto_rejected")).toBeInTheDocument();
  });

  it("XSS sanity: notes with HTML render as text children, not innerHTML", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[bid({ id: 80, notes: "<script>alert(1)</script>" })]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("XSS sanity: bidder org label renders as text", () => {
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[bid({ id: 81, bidderOrgLabel: "<img src=x onerror=alert(1)>" })]}
      actions={noopActions}
      onClose={vi.fn()}
    />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("renders alert on action failure (accept)", async () => {
    const actions = {
      ...noopActions,
      acceptInventoryBid: vi.fn(async () => ({ ok: false as const, error: "Forbidden" })),
    };
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={1}
      bids={[bid({ id: 90 })]}
      actions={actions}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByLabelText(/accept bid 90/));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toMatch(/forbidden/i);
  });

  it("onClose fires when Close button clicked", () => {
    const onClose = vi.fn();
    render(<InventoryBidsTab
      inventoryItem={{ id: 601, name: "Ring", ownerOrgId: 1, bidMode: "single" }}
      viewerOrgId={999}
      bids={[]}
      actions={noopActions}
      onClose={onClose}
    />);
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
