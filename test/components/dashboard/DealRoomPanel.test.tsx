import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealRoomPanel } from "@/components/dashboard/DealRoomPanel";
import type { DealRow } from "@/lib/deals/queries";

function makeDeal(over: Partial<DealRow> = {}): DealRow {
  return {
    id: 1, kind: "SELL", category: "Diamond",
    subject: "Round 1.02ct G/VS1",
    quantity: 1, priceCents: 1240000, currency: "USD",
    status: "Open", postedByLabel: "boss",
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  };
}

describe("DealRoomPanel", () => {
  it("renders BUY and SELL kind badges", () => {
    render(<DealRoomPanel deals={[
      makeDeal({ id: 1, kind: "BUY", subject: "buy lot" }),
      makeDeal({ id: 2, kind: "SELL", subject: "sell lot" }),
    ]} />);
    expect(screen.getByText("BUY")).toBeInTheDocument();
    expect(screen.getByText("SELL")).toBeInTheDocument();
  });

  it("renders the subject as plain text", () => {
    render(<DealRoomPanel deals={[makeDeal({ subject: "Emerald 3.4ct" })]} />);
    expect(screen.getByText("Emerald 3.4ct")).toBeInTheDocument();
  });

  it("does NOT execute script in subject (XSS)", () => {
    const subject = "<script>alert(1)</script>";
    const { container } = render(<DealRoomPanel deals={[makeDeal({ subject })]} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(subject);
  });

  it("renders formatted price", () => {
    render(<DealRoomPanel deals={[makeDeal({ priceCents: 1240000 })]} />);
    expect(screen.getByText(/\$12,400/)).toBeInTheDocument();
  });

  it("renders an empty state when no deals", () => {
    render(<DealRoomPanel deals={[]} />);
    expect(screen.getByText(/no open deals/i)).toBeInTheDocument();
  });

  it('"View all" link points to /deals', () => {
    render(<DealRoomPanel deals={[makeDeal()]} />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/deals");
  });
});
