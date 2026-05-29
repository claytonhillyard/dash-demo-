import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DashboardGrid } from "@/app/DashboardGrid";
import { useSettings } from "@/store/settings";

// PriceTrendPanel and UnitConverterPanel fetch on mount; stub so the grid test is quiet.
beforeEach(() =>
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ points: [], freshness: "live", currencies: {} }),
  } as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("DashboardGrid", () => {
  it("renders the live panels and honest business placeholders", () => {
    const inventory = {
      counts: {
        Rings: 5, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
        Chains: 0, "Watch Bands": 0, Diamonds: 10, Gems: 0,
      },
      total: 15,
      updatedLabel: "updated today",
    };
    const diamond = {
      kpis: { naturalIndex: { cents: 800000, change24hPct: 1.2 }, labIndex: null },
      rows: [{ label: "Natural 1ct", cents: 800000, change24hPct: 1.2 }],
    };
    const deals = {
      deals: [{
        id: 1, orgId: 1, kind: "SELL" as const, category: "Diamond" as const,
        subject: "Round 1.02ct G/VS1", quantity: 1, priceCents: 1240000,
        currency: "USD", status: "Open" as const, postedByLabel: "boss",
        visibilityCircleId: null,
        createdAt: new Date(Date.now() - 3_600_000),
      }],
    };
    render(<DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Inventory is now REAL (not a placeholder):
    expect(screen.getByTestId("inv-tile-Diamonds")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-natural-diamond").textContent).toMatch(/8000\.00|8,000\.00/);
    // Deal Room panel is now REAL (replaced the tradenet-exchange placeholder)
    expect(screen.getByText("Deal Room")).toBeInTheDocument();
    expect(screen.getByText("Round 1.02ct G/VS1")).toBeInTheDocument();
    // Remaining business placeholders still honest:
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("renders the edit-mode controls when editMode is on", () => {
    useSettings.setState({ editMode: true, dashboardLayout: null } as never);
    const inventory = {
      counts: {
        Rings: 5, Necklaces: 0, Earrings: 0, Bracelets: 0, Pendants: 0,
        Chains: 0, "Watch Bands": 0, Diamonds: 10, Gems: 0,
      },
      total: 15,
      updatedLabel: "updated today",
    };
    render(<DashboardGrid inventory={inventory} />);
    expect(screen.getByLabelText(/move panel price-trend/i)).toBeInTheDocument();
    useSettings.setState({ editMode: false } as never);
  });
});

// ---------------------------------------------------------------------------
// dnd-kit keyboard-reorder integration test.
//
// Spec 1c §6 requires "simulated keyboard reorder updates the layout array
// (use the dnd-kit keyboardSensor test helpers)." The store-level reorder
// is already unit-tested. This test exercises the full pipeline:
//   drag handle keydown → KeyboardSensor activates → sortableKeyboardCoordinates
//   resolves the over-target → DndContext.onDragEnd → store.reorderLayout
//
// dnd-kit's collision detection needs measurable rects. jsdom returns 0×0
// rects by default, so we mock getBoundingClientRect to give every rendered
// element a Y offset proportional to its DOM position. That's enough for
// ArrowDown to find the panel "below" the active one.
// ---------------------------------------------------------------------------

describe("DashboardGrid — keyboard reorder", () => {
  let originalRect: typeof Element.prototype.getBoundingClientRect;
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    // dnd-kit uses ResizeObserver to re-measure droppable rects. jsdom
    // doesn't ship one, so we install a no-op polyfill — dnd-kit only
    // needs it to be constructable + observable.
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() { /* no-op */ }
      unobserve() { /* no-op */ }
      disconnect() { /* no-op */ }
    } as unknown as typeof globalThis.ResizeObserver;

    // Reset the layout subsystem to defaults so we know exactly what order
    // the panels are in when the test starts.
    useSettings.setState({ editMode: true, dashboardLayout: null } as never);

    // Mock rects: each panel wrapper gets a Y offset based on its position
    // within its parent grid. dnd-kit's sortableKeyboardCoordinates uses
    // rects to decide which neighbor is "down" for ArrowDown — without this,
    // every element is at (0,0,0,0) in jsdom and ArrowDown finds nothing.
    originalRect = Element.prototype.getBoundingClientRect;
    const HEIGHT = 100;
    const WIDTH = 200;
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const parent = this.parentElement;
      const idx = parent ? Array.from(parent.children).indexOf(this) : 0;
      const top = idx * HEIGHT;
      const rect = {
        x: 0, y: top, top, left: 0, right: WIDTH, bottom: top + HEIGHT,
        width: WIDTH, height: HEIGHT,
        toJSON() { return this; },
      };
      return rect as DOMRect;
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    if (originalResizeObserver === undefined) {
      // @ts-expect-error — deleting a property on globalThis
      delete globalThis.ResizeObserver;
    } else {
      globalThis.ResizeObserver = originalResizeObserver;
    }
    useSettings.setState({ editMode: false, dashboardLayout: null } as never);
  });

  it("Space + ArrowDown + Space moves the first panel down one slot", async () => {
    render(<DashboardGrid />);

    // Sanity-check the starting order: market-intelligence is panel 0,
    // price-trend is panel 1 (per registry defaultLayout).
    const handle = screen.getByLabelText(/move panel market-intelligence/i);
    expect(handle).toBeInTheDocument();

    // Confirm dnd-kit has attached its draggable attributes to the handle —
    // if these are missing the keyboard sensor was never wired up and the
    // rest of the test would silently no-op.
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    expect(handle.getAttribute("aria-disabled")).toBe("false");
    expect(handle.tabIndex).toBe(0);

    // dnd-kit's KeyboardSensor.attach() registers the movement keydown
    // listener via `setTimeout(...)`, so after firing Space on the handle
    // we have to flush macrotasks before ArrowDown fires — otherwise the
    // listener isn't attached yet and the arrow is silently dropped.
    // The movement listener is on `document` (getOwnerDocument(target)).
    await act(async () => {
      fireEvent.keyDown(handle, { key: " ", code: "Space" });
    });
    // Flush the setTimeout that registers the post-activation listener.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowDown", code: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: " ", code: "Space" });
    });

    const layout = useSettings.getState().dashboardLayout;
    expect(layout).not.toBeNull();
    // After moving market-intelligence past price-trend, the first two slots
    // should be swapped — proving the keyboard sensor → onDragEnd →
    // reorderLayout pipeline really fires end-to-end (sensor activation,
    // collision detection, store mutation).
    expect(layout![0].id).toBe("price-trend");
    expect(layout![1].id).toBe("market-intelligence");
  });
});
