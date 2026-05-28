# AIYA Customizable Layout (Slice 1c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag-reorder + resize (col-span) + hide/show + reset for the dashboard's main panels, behind an explicit "Customize" mode, persisted per-user in the existing settings store.

**Architecture:** A small **panel registry** (id → render(ctx)) replaces the hand-written grid; a **layout array** (id + size + hidden) lives in the Zustand/`persist` settings store; `DashboardGrid` walks the effective layout (registry-reconciled). In edit mode each panel is wrapped in a dnd-kit `useSortable` with a drag handle + size cycle + hide button.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zustand (`persist`), dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-27-aiya-customizable-layout-slice-1c-design.md`

**Conventions:** single test file: `npx vitest run <path>`. The KPI ticker stays fixed (not in the registry). `PanelSize = 1 | 2 | 4` maps to `xl:col-span-{1,2,4}`. Commit after every green step.

---

## Phase A — Foundation

### Task A1: Panel registry + types + `getEffectiveLayout`

**Files:** Create `src/lib/layout/types.ts`, `src/lib/layout/registry.ts`; Test `test/lib/layout/registry.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/layout/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PANEL_REGISTRY, getEffectiveLayout, defaultLayout } from "@/lib/layout/registry";

describe("panel registry + effective layout", () => {
  it("exports a registry of dashboard panels (id, title, defaultSize, render)", () => {
    expect(PANEL_REGISTRY.length).toBeGreaterThan(5);
    for (const p of PANEL_REGISTRY) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.title).toBe("string");
      expect([1, 2, 4]).toContain(p.defaultSize);
      expect(typeof p.render).toBe("function");
    }
  });

  it("default layout matches the registry in order, default size, none hidden", () => {
    const def = defaultLayout();
    expect(def.map((i) => i.id)).toEqual(PANEL_REGISTRY.map((p) => p.id));
    expect(def.every((i) => !i.hidden)).toBe(true);
  });

  it("getEffectiveLayout(null) returns the default", () => {
    expect(getEffectiveLayout(null)).toEqual(defaultLayout());
  });

  it("getEffectiveLayout reconciles: drops unknown ids, appends new registry panels at the end", () => {
    const partial = [
      { id: "price-trend", size: 4 as const, hidden: false },
      { id: "unknown-ghost", size: 1 as const, hidden: false },
    ];
    const eff = getEffectiveLayout(partial);
    expect(eff[0]).toEqual({ id: "price-trend", size: 4, hidden: false });
    // unknown dropped
    expect(eff.find((i) => i.id === "unknown-ghost")).toBeUndefined();
    // every registry id is present exactly once
    const ids = eff.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PANEL_REGISTRY) expect(ids).toContain(p.id);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/layout/registry.test.ts`

- [ ] **Step 3: Create `src/lib/layout/types.ts`:**

```ts
import type { ReactNode } from "react";
import type { DiamondKpis } from "@/components/market/KpiTicker";
import type { DiamondRow } from "@/components/market/MarketIntelligencePanel";
import type { InventoryCategory } from "@/lib/inventory/validation";

export type PanelSize = 1 | 2 | 4;

export interface LayoutItem {
  id: string;
  size: PanelSize;
  hidden: boolean;
}

/** Server-read views the page passes down — defined here (not in DashboardGrid)
 *  so the layout types don't depend on the grid that consumes them. */
export interface InventoryView {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedLabel: string | null;
}

export interface DiamondView {
  kpis: DiamondKpis;
  rows: DiamondRow[];
}

/** Server-read context the page passes into each panel's render. */
export interface PanelCtx {
  inventory?: InventoryView;
  diamond?: DiamondView;
}

export interface PanelEntry {
  id: string;
  title: string;
  defaultSize: PanelSize;
  render: (ctx: PanelCtx) => ReactNode;
}
```

(`InventoryView` and `DiamondView` move here from `DashboardGrid` so the layout types don't depend on the grid that uses them. Task B2 imports them back into `DashboardGrid` from this module instead of defining them locally.)

- [ ] **Step 4: Create `src/lib/layout/registry.ts`:**

```ts
import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";
import { BusinessPlaceholder } from "@/components/dashboard/BusinessPlaceholder";
import { InventoryOverviewPanel } from "@/components/dashboard/InventoryOverviewPanel";
import type { LayoutItem, PanelEntry, PanelSize } from "./types";

/** Registry order = the default visible order on the dashboard. */
export const PANEL_REGISTRY: PanelEntry[] = [
  {
    id: "market-intelligence",
    title: "Market Intelligence",
    defaultSize: 1,
    render: (ctx) => <MarketIntelligencePanel diamondRows={ctx.diamond?.rows} />,
  },
  {
    id: "price-trend",
    title: "Price Trend Analytics",
    defaultSize: 2,
    render: () => <PriceTrendPanel />,
  },
  {
    id: "clock-calendar",
    title: "Calendar",
    defaultSize: 1,
    render: () => <ClockCalendar />,
  },
  {
    id: "ai-insights",
    title: "AI Insights",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="AI Insights" testid="panel-ai-insights" />,
  },
  {
    id: "todays-schedule",
    title: "Today's Schedule",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Today's Schedule" testid="panel-todays-schedule" />,
  },
  {
    id: "inventory-overview",
    title: "Inventory Overview",
    defaultSize: 1,
    render: (ctx) =>
      ctx.inventory ? (
        <InventoryOverviewPanel
          counts={ctx.inventory.counts}
          total={ctx.inventory.total}
          updatedLabel={ctx.inventory.updatedLabel}
        />
      ) : (
        <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
      ),
  },
  {
    id: "tradenet-exchange",
    title: "TradeNet Exchange",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="TradeNet Exchange" testid="panel-tradenet-exchange" />,
  },
  {
    id: "orders-pipeline",
    title: "Orders & Pipeline",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Orders & Pipeline" testid="panel-orders-pipeline" />,
  },
  {
    id: "portfolio-snapshot",
    title: "Portfolio Snapshot",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Portfolio Snapshot" testid="panel-portfolio-snapshot" />,
  },
  {
    id: "unit-converter",
    title: "Unit Converter",
    defaultSize: 1,
    render: () => <UnitConverterPanel />,
  },
  {
    id: "crypto-wallet",
    title: "Crypto Wallet",
    defaultSize: 1,
    render: () => <BusinessPlaceholder title="Crypto Wallet" testid="panel-crypto-wallet" />,
  },
  {
    id: "financial-overview",
    title: "Financial Overview",
    defaultSize: 2,
    render: () => <BusinessPlaceholder title="Financial Overview" testid="panel-financial-overview" />,
  },
  {
    id: "social-inbox",
    title: "Social & Inbox",
    defaultSize: 2,
    render: () => <BusinessPlaceholder title="Social & Inbox" testid="panel-social-inbox" />,
  },
];

const REGISTRY_BY_ID = new Map(PANEL_REGISTRY.map((p) => [p.id, p]));

export function getPanel(id: string): PanelEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

export function defaultLayout(): LayoutItem[] {
  return PANEL_REGISTRY.map((p) => ({ id: p.id, size: p.defaultSize, hidden: false }));
}

/**
 * Resolve a persisted layout against the current registry:
 *  - drop ids no longer in the registry,
 *  - keep persisted items in their saved order,
 *  - append any registry panels not in the persisted list at the end (so newly-added
 *    panels in future slices auto-appear).
 */
export function getEffectiveLayout(persisted: LayoutItem[] | null): LayoutItem[] {
  if (!persisted) return defaultLayout();
  const seen = new Set<string>();
  const kept: LayoutItem[] = [];
  for (const it of persisted) {
    const reg = REGISTRY_BY_ID.get(it.id);
    if (!reg) continue;
    seen.add(it.id);
    kept.push({
      id: it.id,
      size: ([1, 2, 4].includes(it.size) ? it.size : reg.defaultSize) as PanelSize,
      hidden: !!it.hidden,
    });
  }
  for (const p of PANEL_REGISTRY) {
    if (!seen.has(p.id)) kept.push({ id: p.id, size: p.defaultSize, hidden: false });
  }
  return kept;
}
```

- [ ] **Step 5: Run → PASS.** `npx vitest run test/lib/layout/registry.test.ts` (4 tests). Run `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit.** `git add src/lib/layout/types.ts src/lib/layout/registry.ts test/lib/layout/registry.test.ts && git commit -m "feat(layout): panel registry + getEffectiveLayout reconciliation"`

---

### Task A2: Extend settings store with `dashboardLayout` + edit mode

**Files:** Modify `src/store/settings.ts`; Test `test/store/settings.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/store/settings.test.ts`:

```ts
import { defaultLayout } from "@/lib/layout/registry";

describe("settings store — layout", () => {
  beforeEach(() => useSettings.setState({
    settings: { ...DEFAULT_SETTINGS },
    editMode: false,
    dashboardLayout: null,
  } as never));

  it("editMode is false by default and can be toggled", () => {
    expect(useSettings.getState().editMode).toBe(false);
    useSettings.getState().setEditMode(true);
    expect(useSettings.getState().editMode).toBe(true);
  });

  it("reorderLayout moves an item; first call materializes the default", () => {
    const def = defaultLayout();
    expect(useSettings.getState().dashboardLayout).toBeNull();
    useSettings.getState().reorderLayout(def[0].id, def[2].id); // move item 0 to position 2
    const layout = useSettings.getState().dashboardLayout!;
    expect(layout[2].id).toBe(def[0].id);
    expect(layout[0].id).toBe(def[1].id);
  });

  it("setPanelSize updates a panel's size", () => {
    useSettings.getState().setPanelSize("price-trend", 4);
    const layout = useSettings.getState().dashboardLayout!;
    expect(layout.find((i) => i.id === "price-trend")!.size).toBe(4);
  });

  it("togglePanelHidden flips the hidden flag", () => {
    useSettings.getState().togglePanelHidden("ai-insights");
    expect(useSettings.getState().dashboardLayout!.find((i) => i.id === "ai-insights")!.hidden).toBe(true);
    useSettings.getState().togglePanelHidden("ai-insights");
    expect(useSettings.getState().dashboardLayout!.find((i) => i.id === "ai-insights")!.hidden).toBe(false);
  });

  it("resetLayout clears to null (= use default)", () => {
    useSettings.getState().setPanelSize("price-trend", 4);
    useSettings.getState().resetLayout();
    expect(useSettings.getState().dashboardLayout).toBeNull();
  });
});
```

(Ensure `beforeEach`, `describe`, `it`, `expect` are imported from vitest at the top of the file; they already should be from the existing suite.)

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/store/settings.test.ts`

- [ ] **Step 3: Implement.** Replace `src/store/settings.ts` with:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultLayout, getEffectiveLayout } from "@/lib/layout/registry";
import type { LayoutItem, PanelSize } from "@/lib/layout/types";

export type Density = "compact" | "comfortable";
export interface Settings {
  amoled: boolean;
  reduceMotion: boolean;
  goldIntensity: number;
  uiScale: number;
  density: Density;
  refreshSeconds: number;
  hiddenPanels: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  amoled: false,
  reduceMotion: false,
  goldIntensity: 0.8,
  uiScale: 1,
  density: "comfortable",
  refreshSeconds: 15,
  hiddenPanels: [],
};

interface SettingsState {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;

  // Layout customization
  editMode: boolean;
  dashboardLayout: LayoutItem[] | null;
  setEditMode: (on: boolean) => void;
  reorderLayout: (fromId: string, toId: string) => void;
  setPanelSize: (id: string, size: PanelSize) => void;
  togglePanelHidden: (id: string) => void;
  resetLayout: () => void;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function materialized(layout: LayoutItem[] | null): LayoutItem[] {
  return layout ?? defaultLayout();
}

export const useSettings = create<SettingsState>()(
  persist(
    (setState) => ({
      settings: { ...DEFAULT_SETTINGS },
      set: (key, value) =>
        setState((state) => {
          const next = { ...state.settings, [key]: value };
          if (key === "refreshSeconds") next.refreshSeconds = clamp(next.refreshSeconds, 5, 600);
          if (key === "uiScale") next.uiScale = clamp(next.uiScale, 0.8, 1.25);
          if (key === "goldIntensity") next.goldIntensity = clamp(next.goldIntensity, 0, 1);
          return { settings: next };
        }),

      editMode: false,
      dashboardLayout: null,
      setEditMode: (on) => setState({ editMode: on }),

      reorderLayout: (fromId, toId) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          const fromIdx = base.findIndex((i) => i.id === fromId);
          const toIdx = base.findIndex((i) => i.id === toId);
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return state;
          const next = [...base];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          return { dashboardLayout: next };
        }),

      setPanelSize: (id, size) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          return { dashboardLayout: base.map((i) => (i.id === id ? { ...i, size } : i)) };
        }),

      togglePanelHidden: (id) =>
        setState((state) => {
          const base = getEffectiveLayout(state.dashboardLayout);
          return { dashboardLayout: base.map((i) => (i.id === id ? { ...i, hidden: !i.hidden } : i)) };
        }),

      resetLayout: () => setState({ dashboardLayout: null }),
    }),
    {
      name: "ccc-settings",
      // editMode is transient — don't persist it.
      partialize: (state) => ({
        settings: state.settings,
        dashboardLayout: state.dashboardLayout,
      }) as Partial<SettingsState>,
    }
  )
);
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/store/settings.test.ts` (existing + 5 new). Run `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit.** `git add src/store/settings.ts test/store/settings.test.ts && git commit -m "feat(layout): persist dashboardLayout + edit-mode mutators in settings store"`

---

### Task A3: Install dnd-kit + SortablePanel wrapper

**Files:** Modify `package.json`/lockfile; Create `src/components/dashboard/SortablePanel.tsx`; Test `test/components/dashboard/SortablePanel.test.tsx`

- [ ] **Step 1: Install dnd-kit.** Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: three packages added to `dependencies` and the lockfile updated.

- [ ] **Step 2: Failing test.** Create `test/components/dashboard/SortablePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortablePanel } from "@/components/dashboard/SortablePanel";

function wrap(children: React.ReactNode) {
  return (
    <DndContext>
      <SortableContext items={["a"]}>{children}</SortableContext>
    </DndContext>
  );
}

describe("SortablePanel", () => {
  it("renders children and no edit controls when editMode=false", () => {
    render(wrap(
      <SortablePanel id="a" size={1} editMode={false}
        onCycleSize={vi.fn()} onToggleHidden={vi.fn()}>
        <div>content</div>
      </SortablePanel>
    ));
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByLabelText(/move panel/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/cycle size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/hide panel/i)).not.toBeInTheDocument();
  });

  it("renders drag handle + size cycle + hide buttons when editMode=true", () => {
    const onCycleSize = vi.fn();
    const onToggleHidden = vi.fn();
    render(wrap(
      <SortablePanel id="a" size={1} editMode={true}
        onCycleSize={onCycleSize} onToggleHidden={onToggleHidden}>
        <div>content</div>
      </SortablePanel>
    ));
    const move = screen.getByLabelText(/move panel/i);
    expect(move).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/cycle size/i));
    expect(onCycleSize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(/hide panel/i));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run test/components/dashboard/SortablePanel.test.tsx`

- [ ] **Step 4: Implement.** Create `src/components/dashboard/SortablePanel.tsx`:

```tsx
"use client";
import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PanelSize } from "@/lib/layout/types";

const COL_SPAN: Record<PanelSize, string> = {
  1: "xl:col-span-1",
  2: "xl:col-span-2",
  4: "xl:col-span-4",
};

export function SortablePanel({
  id, size, editMode, onCycleSize, onToggleHidden, children,
}: {
  id: string;
  size: PanelSize;
  editMode: boolean;
  onCycleSize: () => void;
  onToggleHidden: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editMode });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${COL_SPAN[size]} relative ${editMode ? "ring-1 ring-gold/30 rounded-xl" : ""}`}
    >
      {editMode && (
        <div className="absolute -top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface-2/90 px-1.5 py-0.5 text-[10px] backdrop-blur">
          <button
            {...attributes}
            {...listeners}
            aria-label={`Move panel ${id}`}
            className="cursor-grab px-1 text-text/60 hover:text-gold active:cursor-grabbing"
            type="button"
          >
            ⠿
          </button>
          <button
            aria-label={`Cycle size ${id}`}
            onClick={onCycleSize}
            className="px-1 text-text/60 hover:text-gold"
            type="button"
          >
            ↔ {size}
          </button>
          <button
            aria-label={`Hide panel ${id}`}
            onClick={onToggleHidden}
            className="px-1 text-text/60 hover:text-bad"
            type="button"
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run → PASS.** `npx vitest run test/components/dashboard/SortablePanel.test.tsx`. Run `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit.** `git add package.json package-lock.json src/components/dashboard/SortablePanel.tsx test/components/dashboard/SortablePanel.test.tsx && git commit -m "feat(layout): install dnd-kit + SortablePanel wrapper with edit controls"`

---

## Phase B — Wire it into the dashboard

### Task B1: Customize toggle + edit bar

**Files:** Create `src/components/dashboard/CustomizeButton.tsx`, `src/components/dashboard/LayoutEditBar.tsx`; Test `test/components/dashboard/CustomizeButton.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/dashboard/CustomizeButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSettings } from "@/store/settings";
import { CustomizeButton } from "@/components/dashboard/CustomizeButton";

describe("CustomizeButton", () => {
  beforeEach(() => useSettings.setState({ editMode: false, dashboardLayout: null } as never));
  it("toggles editMode on click", () => {
    render(<CustomizeButton />);
    expect(useSettings.getState().editMode).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /customize/i }));
    expect(useSettings.getState().editMode).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(useSettings.getState().editMode).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/dashboard/CustomizeButton.test.tsx`

- [ ] **Step 3: Implement CustomizeButton.** Create `src/components/dashboard/CustomizeButton.tsx`:

```tsx
"use client";
import { useSettings } from "@/store/settings";

export function CustomizeButton() {
  const editMode = useSettings((s) => s.editMode);
  const setEditMode = useSettings((s) => s.setEditMode);
  return (
    <button
      onClick={() => setEditMode(!editMode)}
      className={`rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-widest transition-colors ${
        editMode ? "bg-gold/20 text-gold border-gold/40" : "text-text/60 hover:text-gold hover:border-gold/40"
      }`}
      type="button"
      aria-label={editMode ? "Done customizing layout" : "Customize layout"}
    >
      {editMode ? "✓ Done" : "Customize"}
    </button>
  );
}
```

- [ ] **Step 4: Implement LayoutEditBar.** Create `src/components/dashboard/LayoutEditBar.tsx`:

```tsx
"use client";
import { useSettings } from "@/store/settings";

export function LayoutEditBar() {
  const editMode = useSettings((s) => s.editMode);
  const resetLayout = useSettings((s) => s.resetLayout);
  if (!editMode) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs text-text/70">
      <span><span className="text-gold">Customize layout</span> — drag to reorder · resize · hide</span>
      <button
        type="button"
        onClick={resetLayout}
        className="text-[11px] uppercase tracking-widest text-text/50 hover:text-gold"
      >
        Reset to default
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run → PASS.** `npx vitest run test/components/dashboard/CustomizeButton.test.tsx`. Run `npx tsc --noEmit` → clean.

- [ ] **Step 6: Place the button in the TopBar.** In `src/components/dashboard/TopBar.tsx`, add `import { CustomizeButton } from "./CustomizeButton";` and render `<CustomizeButton />` inside the right-side action group (next to the existing notification/mail icons; place it BEFORE the icons). Confirm the existing `TopBar` test still passes: `npx vitest run test/components/dashboard/TopBar.test.tsx`.

- [ ] **Step 7: Commit.** `git add src/components/dashboard/CustomizeButton.tsx src/components/dashboard/LayoutEditBar.tsx src/components/dashboard/TopBar.tsx test/components/dashboard/CustomizeButton.test.tsx && git commit -m "feat(layout): Customize toggle in TopBar + LayoutEditBar with reset"`

---

### Task B2: Refactor `DashboardGrid` to render from the registry + dnd-kit

**Files:** Modify `src/app/DashboardGrid.tsx`; Test `test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Update the Dashboard test.** The existing test passes `inventory` + `diamond` and asserts specific titles + testids. The registry preserves the same panel set and titles, so most assertions stay. Add a new assertion: in edit mode, the move handle for a panel renders. Append a new `it(...)` inside the existing `describe`:

```tsx
  it("renders the edit-mode controls when editMode is on", () => {
    const { useSettings } = await import("@/store/settings");
    useSettings.setState({ editMode: true, dashboardLayout: null } as never);
    render(<DashboardGrid />);
    expect(screen.getByLabelText(/move panel price-trend/i)).toBeInTheDocument();
    useSettings.setState({ editMode: false } as never);
  });
```

Wait — `await import` inside a synchronous `it` doesn't work. Replace that snippet with a synchronous version:

```tsx
  it("renders the edit-mode controls when editMode is on", () => {
    // dynamic require to avoid mock issues
    require("@/store/settings").useSettings.setState({ editMode: true, dashboardLayout: null });
    render(<DashboardGrid />);
    expect(screen.getByLabelText(/move panel price-trend/i)).toBeInTheDocument();
    require("@/store/settings").useSettings.setState({ editMode: false });
  });
```

Vitest supports CommonJS `require` in TS test files. Alternatively use a top-of-file `import { useSettings } from "@/store/settings"` once and re-use it.

A cleaner replacement (do this version): at the top of the test file, add `import { useSettings } from "@/store/settings";` and update the new test to:

```tsx
  it("renders the edit-mode controls when editMode is on", () => {
    useSettings.setState({ editMode: true, dashboardLayout: null } as never);
    render(<DashboardGrid />);
    expect(screen.getByLabelText(/move panel price-trend/i)).toBeInTheDocument();
    useSettings.setState({ editMode: false } as never);
  });
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/dashboard/Dashboard.test.tsx` (no edit-mode controls render yet).

- [ ] **Step 3: Implement the data-driven DashboardGrid.** Replace `src/app/DashboardGrid.tsx` with:

```tsx
"use client";
import { useMemo } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { KpiTicker } from "@/components/market/KpiTicker";
import type { PanelSize, InventoryView, DiamondView } from "@/lib/layout/types";
import { getPanel, getEffectiveLayout } from "@/lib/layout/registry";
import { useSettings } from "@/store/settings";
import { SortablePanel } from "@/components/dashboard/SortablePanel";
import { LayoutEditBar } from "@/components/dashboard/LayoutEditBar";

// Re-export the view types so callers that previously imported them from
// DashboardGrid (e.g. page.tsx) keep working without an extra import path.
export type { InventoryView, DiamondView } from "@/lib/layout/types";

const NEXT_SIZE: Record<PanelSize, PanelSize> = { 1: 2, 2: 4, 4: 1 };

export function DashboardGrid({ inventory, diamond }: { inventory?: InventoryView; diamond?: DiamondView }) {
  const editMode = useSettings((s) => s.editMode);
  const persisted = useSettings((s) => s.dashboardLayout);
  const reorderLayout = useSettings((s) => s.reorderLayout);
  const setPanelSize = useSettings((s) => s.setPanelSize);
  const togglePanelHidden = useSettings((s) => s.togglePanelHidden);

  const layout = useMemo(() => getEffectiveLayout(persisted), [persisted]);
  const visible = layout.filter((i) => !i.hidden);
  const ctx = { inventory, diamond };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderLayout(String(active.id), String(over.id));
  }

  return (
    <div className="space-y-3" data-testid="dashboard-root">
      <KpiTicker diamond={diamond?.kpis} />
      <LayoutEditBar />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            {visible.map((item) => {
              const panel = getPanel(item.id);
              if (!panel) return null;
              return (
                <SortablePanel
                  key={item.id}
                  id={item.id}
                  size={item.size}
                  editMode={editMode}
                  onCycleSize={() => setPanelSize(item.id, NEXT_SIZE[item.size])}
                  onToggleHidden={() => togglePanelHidden(item.id)}
                >
                  {panel.render(ctx)}
                </SortablePanel>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/dashboard/Dashboard.test.tsx` (existing assertions + the new edit-mode one). Run `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit.** `git add src/app/DashboardGrid.tsx test/components/dashboard/Dashboard.test.tsx && git commit -m "feat(layout): data-driven DashboardGrid via registry + dnd-kit"`

---

## Phase C — Verification

### Task C1: Full suite + tsc + build + dev smoke

- [ ] **Step 1:** Full suite. `npm test` → all green (existing + new).
- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3:** `rm -rf .next && npm run build` → success.
- [ ] **Step 4: Manual smoke** (`npm run dev`, log in):
  - Top bar shows **Customize**. Click → edit mode: each panel grows a drag handle + size cycle + hide button; the LayoutEditBar appears.
  - Drag a panel — order changes; refresh browser — change persists.
  - Click size on a wide panel — cycles 1 → 2 → 4 → 1 and the col-span updates.
  - Hide a panel — it disappears. (Re-show via Reset.) Click **Reset to default** — full default layout returns.
  - Click ✓ Done — handles vanish, panels become fully interactive again.
- [ ] **Step 5: Demo smoke.** `NEXT_PUBLIC_DEMO_MODE=true npm run dev` → `/` loads without login; Customize still works; changes persist in this browser only.
- [ ] **Step 6: Commit any fixes** (skip if none).

---

## Done criteria
- All new tests green; full suite green; `tsc` clean; build succeeds.
- Customize button toggles edit mode; drag-reorder + resize + hide/show + reset all work and persist via the existing settings store.
- KPI ticker stays fixed; shell chrome untouched; non-edit-mode behavior identical to today.
- Demo mode unaffected (customization works in-browser).
