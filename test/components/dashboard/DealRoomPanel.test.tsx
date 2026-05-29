import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import type { DealRow } from "@/lib/deals/queries";

function makeDeal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1,
    orgId: 1,
    kind: "SELL",
    category: "Diamond",
    subject: "Round 1.02ct G/VS1",
    quantity: 1,
    priceCents: 1240000,
    currency: "USD",
    status: "Open",
    postedByLabel: "boss",
    visibilityCircleId: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  };
}

const EMPTY_CIRCLES = new Map<number, string>();

describe("DealRoomPanel — slice 2 behavior preserved", () => {
  it("renders BUY and SELL kind badges", () => {
    render(<DealRoomPanel
      deals={[
        makeDeal({ id: 1, kind: "BUY", subject: "buy lot" }),
        makeDeal({ id: 2, kind: "SELL", subject: "sell lot" }),
      ]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
  });

  it("renders the subject as plain text", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ subject: "Emerald 3.4ct" })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText("Emerald 3.4ct")).toBeInTheDocument();
  });

  it("does NOT execute script in subject (XSS)", () => {
    const subject = "<script>alert(1)</script>";
    const { container } = render(<DealRoomPanel
      deals={[makeDeal({ subject })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(subject);
  });

  it("renders formatted price", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ priceCents: 1240000 })]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(screen.getByText(/\$12,400/)).toBeInTheDocument();
  });

  it("renders an empty state when no deals", () => {
    render(<DealRoomPanel deals={[]} currentOrgId={1} circleNamesById={EMPTY_CIRCLES} />);
    expect(screen.getByText(/no open deals/i)).toBeInTheDocument();
  });

  it('"View all" link points to /deals', () => {
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/deals");
  });
});

describe("DealRoomPanel — slice 4 visibility badge", () => {
  const circles = new Map<number, string>([[42, "AIYA Trusted Partners"]]);

  it("renders no badge when visibilityCircleId is null", () => {
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: null })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(queryByTestId("deal-visibility-badge")).toBeNull();
  });

  it("renders the circle name as a badge when the id is in the map", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.textContent).toBe("AIYA Trusted Partners");
  });

  it("XSS: circle name with markup renders as text, not HTML", () => {
    const malicious = new Map([[42, "<script>alert(1)</script>"]]);
    const { container } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={malicious}
    />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("name-leak guard: renders no badge when visibilityCircleId is NOT in the map", () => {
    // Defensive fallback: even if a query bug surfaces a foreign circle id,
    // the badge silently disappears rather than showing a name the viewer
    // shouldn't know.
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal({ visibilityCircleId: 999 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(queryByTestId("deal-visibility-badge")).toBeNull();
  });

  it("own-org circle row: tooltip says 'Shared with [Circle]'", () => {
    render(<DealRoomPanel
      deals={[makeDeal({ orgId: 1, visibilityCircleId: 42 })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.getAttribute("title")).toBe("Shared with AIYA Trusted Partners");
  });

  it("foreign-org circle row: tooltip includes posted-by label", () => {
    render(<DealRoomPanel
      deals={[makeDeal({
        orgId: 888,
        postedByLabel: "Mehta Diamonds — Mumbai",
        visibilityCircleId: 42,
      })]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    const badge = screen.getByTestId("deal-visibility-badge");
    expect(badge.getAttribute("title"))
      .toBe("Shared by Mehta Diamonds — Mumbai via AIYA Trusted Partners");
  });

  it("renders no subtitle when the viewer is in zero circles", () => {
    const { queryByTestId } = render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={EMPTY_CIRCLES}
    />);
    expect(queryByTestId("deal-room-circle-subtitle")).toBeNull();
  });

  it("renders 'Connected via [Name]' subtitle when the viewer is in one circle", () => {
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={circles}
    />);
    expect(screen.getByTestId("deal-room-circle-subtitle").textContent)
      .toBe("Connected via AIYA Trusted Partners");
  });

  it("renders 'Connected to N circles' subtitle when the viewer is in multiple", () => {
    const many = new Map([[42, "A"], [43, "B"], [44, "C"]]);
    render(<DealRoomPanel
      deals={[makeDeal()]}
      currentOrgId={1}
      circleNamesById={many}
    />);
    expect(screen.getByTestId("deal-room-circle-subtitle").textContent)
      .toBe("Connected to 3 circles");
  });
});
