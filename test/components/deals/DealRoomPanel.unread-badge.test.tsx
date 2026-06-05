import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import type { DealRow } from "@/lib/deals/queries";

// Build the minimal fixture shape DealRoomPanel expects.
function deal(id: number, over: Partial<DealRow> = {}): DealRow {
  return {
    id,
    kind: "SELL",
    category: "Diamond",
    subject: `d${id}`,
    quantity: 1,
    priceCents: 1000,
    currency: "USD",
    postedByLabel: "x",
    visibilityCircleId: null,
    threadMode: "private",
    createdAt: new Date(),
    orgId: 1,
    status: "Open",
    ...over,
  };
}

const noopActions = {
  postMessage: vi.fn(async (_i: { dealId: number; body: string }) => ({ ok: true as const })),
  setMode: vi.fn(async (_i: { dealId: number; mode: "private" | "group" }) => ({ ok: true as const })),
  deleteMessage: vi.fn(async (_i: { messageId: number }) => ({ ok: true as const })),
  markRead: vi.fn(async (_i: { dealId: number }) => ({ ok: true as const })),
};

describe("DealRoomPanel — unread badge", () => {
  it("renders no badge for a deal with zero messages", () => {
    render(<DealRoomPanel
      deals={[deal(1)]}
      currentOrgId={1}
      circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map()}
      threadsByDealId={new Map([[1, []]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.queryByText(/new/)).toBeNull();
    expect(screen.queryByText(/💬/)).toBeNull();
  });

  it("renders a subtle 💬 N badge when all messages are read", () => {
    render(<DealRoomPanel
      deals={[deal(1)]}
      currentOrgId={1}
      circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[1, 0]])}
      threadsByDealId={new Map([[1, [
        { id: 1, dealId: 1, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.getByText(/💬 1/)).toBeInTheDocument();
  });

  it("renders prominent 🔴 N new when there are unread", () => {
    render(<DealRoomPanel
      deals={[deal(1)]}
      currentOrgId={1}
      circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[1, 3]])}
      threadsByDealId={new Map([[1, [
        { id: 1, dealId: 1, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={noopActions}
    />);
    expect(screen.getByText(/🔴 3 new/)).toBeInTheDocument();
  });

  it("clicking the chevron fires markRead", () => {
    const actions = {
      ...noopActions,
      markRead: vi.fn(async (_i: { dealId: number }) => ({ ok: true as const })),
    };
    render(<DealRoomPanel
      deals={[deal(42)]}
      currentOrgId={1}
      circleNamesById={new Map()}
      viewerOrgId={1}
      unreadByDealId={new Map([[42, 2]])}
      threadsByDealId={new Map([[42, [
        { id: 1, dealId: 42, fromOrgId: 999, fromOrgLabel: "x", body: "h",
          threadMode: "group", isDeleted: false, createdAt: new Date() },
      ]]])}
      threadModeByDealId={new Map()}
      actions={actions}
    />);
    fireEvent.click(screen.getByLabelText(/toggle thread for deal 42/));
    expect(actions.markRead).toHaveBeenCalledWith({ dealId: 42 });
  });
});
