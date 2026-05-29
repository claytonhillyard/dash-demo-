import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DealList } from "@/components/deals/DealList";
import type { DealRow } from "@/lib/deals/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function deal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1, orgId: 1, kind: "SELL", category: "Diamond", subject: "Round 1.02ct",
    quantity: 1, priceCents: 1240000, currency: "USD",
    status: "Open", postedByLabel: "boss",
    visibilityCircleId: null,
    createdAt: new Date(Date.now() - 60_000),
    ...over,
  };
}

// Most existing tests run as orgId=1 (own-org). Empty map = no circle context.
const OWN_ORG = 1;
const EMPTY_MAP = new Map<number, string>();

beforeEach(() => {
  // skip the window.confirm guard so action tests fire
  vi.stubGlobal("confirm", () => true);
});

describe("DealList", () => {
  it("renders rows with subject as plain text (XSS-safe)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <DealList deals={[deal({ subject: evil })]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(evil);
  });

  it("Open deals show Withdraw and Mark Filled buttons", () => {
    render(
      <DealList deals={[deal()]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.getByRole("button", { name: /withdraw deal 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark deal 1 filled/i })).toBeInTheDocument();
  });

  it("terminal (Filled/Withdrawn) deals do not show action buttons", () => {
    render(
      <DealList deals={[deal({ id: 2, status: "Filled" })]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark.*filled/i })).not.toBeInTheDocument();
  });

  it("clicking Withdraw calls the action with the deal id", async () => {
    const withdrawAction = vi.fn(async () => ({ ok: true as const }));
    render(
      <DealList deals={[deal({ id: 42 })]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={withdrawAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: /withdraw deal 42/i }));
    await waitFor(() => expect(withdrawAction).toHaveBeenCalledWith(42));
  });

  it("surfaces an action error", async () => {
    const withdrawAction = vi.fn(async () => ({ ok: false as const, error: "Database error" }));
    render(
      <DealList deals={[deal({ id: 99 })]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={withdrawAction} />
    );
    fireEvent.click(screen.getByRole("button", { name: /withdraw deal 99/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database error");
  });

  it("renders an empty state when no deals", () => {
    render(
      <DealList deals={[]}
        currentOrgId={OWN_ORG}
        circleNamesById={EMPTY_MAP}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    expect(screen.getByText(/no deals/i)).toBeInTheDocument();
  });

  // --- Slice 4 review finding 3 + 8 ---

  it("own-org private deal shows 'Private' in the Visibility column and renders action buttons", () => {
    render(
      <DealList deals={[deal({ id: 7, visibilityCircleId: null })]}
        currentOrgId={OWN_ORG}
        circleNamesById={new Map([[201, "AIYA Trusted Partners"]])}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    const visCell = screen.getByTestId("deal-visibility-7");
    expect(within(visCell).getByText(/private/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark deal 7 filled/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw deal 7/i })).toBeInTheDocument();
  });

  it("foreign-org row shows the circle badge and does NOT render action buttons", () => {
    const foreign = deal({
      id: 106,
      orgId: 501, // partner org, not OWN_ORG
      postedByLabel: "Mehta Diamonds — Mumbai",
      visibilityCircleId: 201,
    });
    render(
      <DealList deals={[foreign]}
        currentOrgId={OWN_ORG}
        circleNamesById={new Map([[201, "AIYA Trusted Partners"]])}
        markFilledAction={vi.fn(async () => ({ ok: true as const }))}
        withdrawAction={vi.fn(async () => ({ ok: true as const }))} />
    );
    const visCell = screen.getByTestId("deal-visibility-106");
    expect(within(visCell).getByText("AIYA Trusted Partners")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark deal 106 filled/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /withdraw deal 106/i })).not.toBeInTheDocument();
  });
});
