import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WebsiteOverviewPanel } from "@/components/dashboard/WebsiteOverviewPanel";
import type { WebsiteSnapshotRow } from "@/db/website";

// TODO(slice-5 review): Sparkline uses lightweight-charts which depends on
// window.matchMedia (not provided by jsdom by default). Mock the component
// here so the panel under test stays pure — the Sparkline itself already
// forwards data-testid="sparkline" (verified in src/components/market/Sparkline.tsx).
vi.mock("@/components/market/Sparkline", () => ({
  Sparkline: ({ points: _points }: { points: number[] }) => (
    <div data-testid="sparkline" />
  ),
}));

function makeRow(over: Partial<WebsiteSnapshotRow> = {}): WebsiteSnapshotRow {
  return {
    id: 1, orgId: 1, weekStart: "2026-05-25",
    visitors: 7820, uniqueVisitors: 5640, pageViews: 22130,
    avgSessionDurationSeconds: 215, bounceRatePercent: 38,
    createdAt: new Date("2026-05-25T12:00:00Z"),
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    ...over,
  };
}

describe("WebsiteOverviewPanel — no-data state", () => {
  it("renders the empty-state copy with a link to /website", () => {
    render(<WebsiteOverviewPanel latest={null} previous={null} trend={[]} updatedLabel={null} />);
    expect(screen.getByText(/no website snapshots yet/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /website/i });
    expect(link).toHaveAttribute("href", "/website");
  });

  it("renders no KPI tiles in the empty state", () => {
    const { queryByTestId } = render(
      <WebsiteOverviewPanel latest={null} previous={null} trend={[]} updatedLabel={null} />
    );
    expect(queryByTestId("website-kpi-visitors")).toBeNull();
    expect(queryByTestId("website-kpi-pageviews")).toBeNull();
    expect(queryByTestId("website-kpi-avgsession")).toBeNull();
    expect(queryByTestId("website-kpi-bounce")).toBeNull();
  });
});

describe("WebsiteOverviewPanel — single-snapshot state", () => {
  it("renders all 4 KPI tiles", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />);
    expect(screen.getByTestId("website-kpi-visitors")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-pageviews")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-avgsession")).toBeInTheDocument();
    expect(screen.getByTestId("website-kpi-bounce")).toBeInTheDocument();
  });

  it("does NOT render a uniqueVisitors tile (spec §5.1 — 4 KPIs only)", () => {
    const row = makeRow();
    const { queryByTestId } = render(
      <WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel={null} />
    );
    expect(queryByTestId("website-kpi-unique")).toBeNull();
  });

  it("renders em-dash in each delta cell when no previous row exists", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel={null} />);
    // Each KPI tile contains a delta line; with no previous, the delta is em-dash.
    const visitorsTile = screen.getByTestId("website-kpi-visitors");
    expect(visitorsTile.textContent).toContain("—");
  });
});

describe("WebsiteOverviewPanel — multi-snapshot state", () => {
  it("renders KPI tiles with up-arrow delta for visitor growth", () => {
    const latest = makeRow({ visitors: 6000 });
    const previous = makeRow({ visitors: 5000, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={[latest, previous]}
      updatedLabel="updated 1d ago"
    />);
    const tile = screen.getByTestId("website-kpi-visitors");
    expect(tile.textContent).toContain("▲");
    expect(tile.textContent).toContain("20.0%");
  });

  it("renders KPI tiles with down-arrow delta for visitor decline", () => {
    const latest = makeRow({ visitors: 4500 });
    const previous = makeRow({ visitors: 5000, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={[latest, previous]}
      updatedLabel={null}
    />);
    const tile = screen.getByTestId("website-kpi-visitors");
    expect(tile.textContent).toContain("▼");
    expect(tile.textContent).toContain("10.0%");
  });

  it("formats avgSessionDurationSeconds as m:ss in the avg-session tile", () => {
    const latest = makeRow({ avgSessionDurationSeconds: 210 });
    render(<WebsiteOverviewPanel latest={latest} previous={null} trend={[latest]} updatedLabel={null} />);
    expect(screen.getByTestId("website-kpi-avgsession").textContent).toContain("3:30");
  });

  it("formats bounceRatePercent with a percent sign", () => {
    const latest = makeRow({ bounceRatePercent: 42 });
    render(<WebsiteOverviewPanel latest={latest} previous={null} trend={[latest]} updatedLabel={null} />);
    expect(screen.getByTestId("website-kpi-bounce").textContent).toContain("42%");
  });

  it("renders the provenance label with the · owner-entered suffix", () => {
    const row = makeRow();
    render(<WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />);
    expect(screen.getByText(/owner-entered/i)).toBeInTheDocument();
    // Provenance is rendered ONCE — in the footer with the "· owner-entered"
    // suffix (review finding S2: header action slot was removed to avoid
    // double-rendering the label).
    expect(screen.getByText(/updated 2d ago · owner-entered/i)).toBeInTheDocument();
  });

  it("does NOT render a live FreshnessDot anywhere (honesty contract)", () => {
    const row = makeRow();
    const { container } = render(
      <WebsiteOverviewPanel latest={row} previous={null} trend={[row]} updatedLabel="updated 2d ago" />
    );
    // No element with the "live" text or a typical FreshnessDot data-testid.
    expect(container.textContent?.toLowerCase()).not.toContain("live");
  });

  it("renders the visitor sparkline when trend has > 1 row", () => {
    const trend = [
      { weekStart: "2026-05-25", visitors: 6000 },
      { weekStart: "2026-05-18", visitors: 5500 },
      { weekStart: "2026-05-11", visitors: 5200 },
    ];
    const latest = makeRow({ visitors: 6000 });
    const previous = makeRow({ visitors: 5500, weekStart: "2026-05-18" });
    render(<WebsiteOverviewPanel
      latest={latest}
      previous={previous}
      trend={trend.map((t, i) => ({ ...makeRow({
        weekStart: t.weekStart, visitors: t.visitors, id: 100 + i,
      }) }))}
      updatedLabel="updated 1d ago"
    />);
    // Sparkline component renders an element with data-testid="sparkline".
    expect(screen.getByTestId("sparkline")).toBeInTheDocument();
  });
});
