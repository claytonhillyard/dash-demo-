import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import type { Quote } from "@/lib/market/types";

afterEach(() => vi.unstubAllGlobals());

const gold: Quote = {
  symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD",
  price: 2400, changeAbs: 0, changePct: 0, asOf: Date.now(), source: "twelvedata", freshness: "live",
};

describe("UnitConverterPanel", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: gold } }));

  it("loads a broad currency list (30+) into the selectors", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        currencies: Object.fromEntries(
          Array.from({ length: 31 }, (_, i) => [`C${i}`, `Currency ${i}`]),
        ),
      }),
    } as Response));
    render(<UnitConverterPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("from-currency").querySelectorAll("option").length).toBeGreaterThanOrEqual(30),
    );
  });

  it("converts metal weight to USD market value using the live quote", () => {
    // The default Currency tab fires /api/convert on mount; stub it so the test is quiet.
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ currencies: {} }) } as Response));
    render(<UnitConverterPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Metals" }));
    // 1 troy oz of gold at $2400 => $2400 market value
    expect(screen.getByTestId("metal-value").textContent).toContain("2400");
  });

  it("labels a simulated conversion honestly (provenance dot, no ECB claim)", async () => {
    // The conversion call (URL has ?from=) degraded to a simulated estimate; the
    // list call (no params) returns the currency map. The UI must NOT present a
    // fabricated estimate as a real ECB rate.
    vi.stubGlobal("fetch", async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("from=")
          ? { result: 1000, freshness: "simulated" }
          : { currencies: { USD: "United States Dollar", EUR: "Euro" } },
    } as Response));
    render(<UnitConverterPanel />);
    await waitFor(() => {
      const dots = screen.getAllByTestId("freshness-dot");
      expect(dots.some((d) => d.getAttribute("data-freshness") === "simulated")).toBe(true);
    });
    expect(screen.getByText(/live rate unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/ECB daily reference rates/i)).not.toBeInTheDocument();
  });
});
