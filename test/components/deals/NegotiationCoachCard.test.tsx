import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NegotiationCoachCard } from "@/components/deals/NegotiationCoachCard";
import type { NegotiationStats } from "@/lib/negotiation/compute";

// Mirrors test/components/invoices/SendInvoicePanel.test.tsx's indirection
// pattern: top-level trackable mock, module factory just forwards to it.
const getNegotiationCoaching = vi.fn();
vi.mock("@/lib/negotiation/actions", () => ({
  getNegotiationCoaching: (...args: unknown[]) => getNegotiationCoaching(...args),
}));

beforeEach(() => {
  getNegotiationCoaching.mockReset();
});

function coachedStats(
  over: Partial<Extract<NegotiationStats, { kind: "coached" }>> = {},
): Extract<NegotiationStats, { kind: "coached" }> {
  return {
    kind: "coached",
    partnerLabel: "Ginza Pearl",
    closes: 3,
    decidedDeals: 4,
    winRatePct: 75,
    avgUpliftCents: 120_000,
    avgRounds: 2.3,
    medianDaysToDecide: 5,
    currentBestCents: 1_150_000,
    askCents: 1_200_000,
    suggestedCounterCents: 1_250_000,
    ...over,
  };
}

function insufficientStats(
  over: Partial<Extract<NegotiationStats, { kind: "insufficient_history" }>> = {},
): Extract<NegotiationStats, { kind: "insufficient_history" }> {
  return {
    kind: "insufficient_history",
    partnerLabel: "Ginza Pearl",
    closes: 1,
    currentBestCents: 1_100_000,
    askCents: 1_200_000,
    ...over,
  };
}

const baseProps = { dealId: 7, leadBidderOrgId: 42, leadBidderLabel: "Ginza Pearl" };

describe("NegotiationCoachCard — idle", () => {
  it("renders the Coach me button and one muted line naming the partner", () => {
    render(<NegotiationCoachCard {...baseProps} />);
    expect(screen.getByRole("button", { name: /coach me/i })).toBeInTheDocument();
    expect(screen.getByText(/Ginza Pearl/)).toBeInTheDocument();
    expect(getNegotiationCoaching).not.toHaveBeenCalled();
  });
});

describe("NegotiationCoachCard — click", () => {
  it("calls getNegotiationCoaching with exactly {dealId, bidderOrgId}", async () => {
    getNegotiationCoaching.mockResolvedValue({ ok: true, stats: coachedStats(), lines: ["line1"], simulated: false });
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    await waitFor(() =>
      expect(getNegotiationCoaching).toHaveBeenCalledWith({ dealId: 7, bidderOrgId: 42 }),
    );
  });
});

describe("NegotiationCoachCard — coached result", () => {
  it("renders the advice lines, the stat strip, and the suggested counter as the hero", async () => {
    getNegotiationCoaching.mockResolvedValue({
      ok: true,
      stats: coachedStats(),
      lines: ["Ginza Pearl usually moves in your favor.", "Counter firm."],
      simulated: false,
    });
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    expect(await screen.findByText("Ginza Pearl usually moves in your favor.")).toBeInTheDocument();
    expect(screen.getByText("Counter firm.")).toBeInTheDocument();

    const stripe = screen.getByLabelText("coach stat strip");
    expect(stripe).toHaveTextContent("3");
    expect(stripe).toHaveTextContent("75%");
    expect(stripe).toHaveTextContent("$1,200.00");
    expect(stripe).toHaveTextContent("2.3");

    expect(screen.getByLabelText("suggested counter")).toHaveTextContent("$12,500.00");
  });
});

describe("NegotiationCoachCard — insufficient history", () => {
  it("renders an honest line (not an empty card) plus what IS known", async () => {
    getNegotiationCoaching.mockResolvedValue({
      ok: true,
      stats: insufficientStats({ closes: 1 }),
      lines: ["Not enough closed history yet."],
      simulated: false,
    });
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    expect(await screen.findByText(/Not enough history with Ginza Pearl yet \(1 closes\)/i)).toBeInTheDocument();
    // What IS known: their best bid + our ask.
    expect(screen.getByText(/\$11,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$12,000\.00/)).toBeInTheDocument();
  });
});

describe("NegotiationCoachCard — simulated", () => {
  it("shows the muted simulated note", async () => {
    getNegotiationCoaching.mockResolvedValue({
      ok: true,
      stats: coachedStats(),
      lines: ["line1"],
      simulated: true,
    });
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    expect(
      await screen.findByText("Simulated — set AI_GATEWAY_API_KEY for live coaching"),
    ).toBeInTheDocument();
  });
});

describe("NegotiationCoachCard — error", () => {
  it("renders an error alert on {ok:false}", async () => {
    getNegotiationCoaching.mockResolvedValue({ ok: false, error: "Forbidden" });
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });
});

describe("NegotiationCoachCard — pending", () => {
  it("disables the button while the call is pending", async () => {
    let resolve!: (v: unknown) => void;
    getNegotiationCoaching.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<NegotiationCoachCard {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /coach me/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /coach/i })).toBeDisabled());
    resolve({ ok: true, stats: coachedStats(), lines: ["line1"], simulated: false });
    await screen.findByLabelText("suggested counter");
  });

  it("does not double-fire on a second click while pending", async () => {
    let resolve!: (v: unknown) => void;
    getNegotiationCoaching.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<NegotiationCoachCard {...baseProps} />);
    const btn = screen.getByRole("button", { name: /coach me/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() => expect(btn).toBeDisabled());
    resolve({ ok: true, stats: coachedStats(), lines: ["line1"], simulated: false });
    await screen.findByLabelText("suggested counter");

    expect(getNegotiationCoaching).toHaveBeenCalledTimes(1);
  });
});
