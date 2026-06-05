import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealThreadAccordion } from "@/components/deals/DealThreadAccordion";
import type { DealMessageView } from "@/db/dealMessages";

const noopActions = {
  postMessage: vi.fn(async (_i: { dealId: number; body: string }) => ({ ok: true as const })),
  setMode: vi.fn(async (_i: { dealId: number; mode: "private" | "group" }) => ({ ok: true as const })),
  deleteMessage: vi.fn(async (_i: { messageId: number }) => ({ ok: true as const })),
};

function msg(over: Partial<DealMessageView>): DealMessageView {
  return {
    id: 1, dealId: 1, fromOrgId: 1, fromOrgLabel: "Org",
    body: "hi", threadMode: "group", isDeleted: false, createdAt: new Date(), ...over,
  };
}

describe("DealThreadAccordion", () => {
  it("renders the empty state when there are no messages", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="private"
      messages={[]} actions={noopActions}
    />);
    expect(screen.getByText(/no replies yet/i)).toBeInTheDocument();
  });

  it("renders messages in order with sender label", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="group"
      messages={[
        msg({ id: 1, fromOrgLabel: "A", body: "first" }),
        msg({ id: 2, fromOrgLabel: "B", body: "second" }),
      ]}
      actions={noopActions}
    />);
    const items = screen.getAllByLabelText("thread message");
    expect(items[0]).toHaveTextContent("A");
    expect(items[0]).toHaveTextContent("first");
    expect(items[1]).toHaveTextContent("B");
    expect(items[1]).toHaveTextContent("second");
  });

  it("renders a mode-switch banner when adjacent messages differ", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="private"
      messages={[
        msg({ id: 1, threadMode: "private", body: "p1" }),
        msg({ id: 2, threadMode: "group", body: "g1" }),
      ]}
      actions={noopActions}
    />);
    expect(screen.getByText(/Mode switched to group/)).toBeInTheDocument();
  });

  it("renders tombstones for soft-deleted messages", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={false} currentMode={null}
      messages={[msg({ id: 1, fromOrgLabel: "Mehta", body: null, isDeleted: true })]}
      actions={noopActions}
    />);
    expect(screen.getByText(/Mehta deleted a message/)).toBeInTheDocument();
  });

  it("submits trimmed body via postMessage", async () => {
    const actions = { ...noopActions, postMessage: vi.fn(async (_i: { dealId: number; body: string }) => ({ ok: true as const })) };
    render(<DealThreadAccordion
      dealId={42} viewerOrgId={1} isOwner={false} currentMode={null}
      messages={[]} actions={actions}
      canPost={true}
    />);
    fireEvent.change(screen.getByLabelText("reply body"), { target: { value: "   hello  " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(actions.postMessage).toHaveBeenCalledTimes(1));
    expect(actions.postMessage.mock.calls[0][0]).toEqual({ dealId: 42, body: "hello" });
  });

  it("hides mode selector when viewer is not the owner", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={999} isOwner={false} currentMode={null}
      messages={[]} actions={noopActions}
    />);
    expect(screen.queryByLabelText("thread mode")).toBeNull();
  });

  it("XSS sanity: a <script> body renders as visible text, not executed HTML", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={1} isOwner={true} currentMode="group"
      messages={[msg({ id: 1, body: "<script>alert(1)</script>" })]}
      actions={noopActions}
    />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });

  it("hides the reply input when canPost=false (private-mode non-owner)", () => {
    render(<DealThreadAccordion
      dealId={1} viewerOrgId={999} isOwner={false} currentMode={null}
      messages={[msg({ id: 1, body: "owner's msg" })]}
      canPost={false}
      actions={noopActions}
    />);
    expect(screen.queryByLabelText("reply body")).toBeNull();
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
    expect(screen.getByText(/limited to the deal owner/i)).toBeInTheDocument();
  });
});
