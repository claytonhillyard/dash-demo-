import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";

afterEach(() => vi.unstubAllGlobals());

describe("PriceTrendPanel", () => {
  it("fetches Gold and BTC history and exposes the loaded ranges", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const symbol = new URL(url, "http://localhost").searchParams.get("symbol");
      return {
        ok: true,
        json: async () => ({ symbol, points: [1, 2, 3], freshness: "live" }),
      } as Response;
    });
    render(<PriceTrendPanel />);
    await waitFor(() => expect(screen.getByTestId("trend-loaded")).toBeInTheDocument());
    expect(calls.some((u) => u.includes("symbol=XAU"))).toBe(true);
    expect(calls.some((u) => u.includes("symbol=BTC"))).toBe(true);
  });

  it("re-fetches when the range changes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ symbol: "BTC", points: [1], freshness: "live" }) } as Response;
    });
    render(<PriceTrendPanel />);
    await waitFor(() => expect(screen.getByTestId("trend-loaded")).toBeInTheDocument());
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(calls.some((u) => u.includes("range=1Y"))).toBe(true);
  });
});
