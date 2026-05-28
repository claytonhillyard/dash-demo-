# AIYA Dashboard — Slice 1c: Customizable Layout — Design

**Date:** 2026-05-27
**Status:** Approved (design); implementation plan pending
**Builds on:** all shipped slices on `main` (0/1/1a/2/1b-1/1b-3/demo).

## 1. Overview & Goals

Let the user **rearrange, resize, hide/show, and reset** the dashboard's main-grid
panels through an explicit **"Customize layout"** mode. The chrome (sidebars, top
bar, footer) and the top KPI ticker stay fixed; the panel grid below becomes
data-driven from a small persisted layout object.

Goals:
- Frictionless customization that **doesn't fight the panels' own interactive content**
  (tabs, inputs, charts) — achieved via an explicit edit mode.
- Discrete, predictable sizing (column-span steps) rather than free-form pixel resize.
- **Per-user persistence** in the existing Zustand/localStorage settings store; no
  schema migration; no DB writes.
- **Accessible:** keyboard-reorder via dnd-kit; drag handles are real buttons with
  labels.
- Demo-mode aware: customization works in demo and stays in the visitor's own
  browser (seeded data and other visitors are unaffected).

Non-goals: free-form 2D pixel resize; per-breakpoint layouts; DB-backed layouts (a
future multi-tenant slice can add a server-side store behind the same API);
rearranging the KPI ticker or shell chrome.

## 2. Interaction Model

- A single **"Customize"** button (in the TopBar) toggles edit mode.
- **Outside edit mode:** the dashboard renders exactly as today (interactive panels,
  no drag controls).
- **Inside edit mode:** every visible panel grows a header strip with:
  - a **drag handle** (button, `aria-label="Move <panel>"`) — keyboard-reorderable via
    dnd-kit's defaults;
  - a **size control** (cycles col-span: ½ / 1 / 2 / wide on the xl 4-col grid);
  - a **hide** button.
  A persistent strip at the top of the grid reads "Customize layout — drag to
  reorder · ✓ Done" with a **Reset to default** secondary action that returns the
  full shipped layout (no hidden panels, default sizes, default order).

## 3. Architecture

### 3.1 Panel registry (`src/lib/layout/registry.ts`)
One object per panel, in default order:

```
{
  id: "market-intelligence",
  title: "Market Intelligence",
  defaultSize: "1",  // "half" | "1" | "2" | "wide"
  render: (ctx: PanelCtx) => ReactNode,
}
```

`PanelCtx` carries the **server-read props** that `page.tsx` already passes (inventory
summary, diamond summary, anything the next slice needs). Live panels read what they
need from `ctx`; the registry shape is the single seam.

This turns `DashboardGrid` from hand-written JSX into "walk an ordered list of ids
and call `render(ctx)`."

### 3.2 Layout state (extend the settings store)
Add a new field to the existing settings:

```
dashboardLayout: { items: Array<{ id: string; size: PanelSize; hidden: boolean }> } | null
```

- `null` (default) ⇒ use the registry's default order/sizes; no hidden panels.
- Mutators in the store: `reorderLayout(fromId, toId)`, `setPanelSize(id, size)`,
  `togglePanelHidden(id)`, `resetLayout()`.
- Selectors: `getEffectiveLayout()` resolves `dashboardLayout` against the registry
  (drops unknown ids; appends registry panels not present in the persisted list, so
  newly-added panels in future slices auto-appear at the end).

Persistence uses the existing localStorage hook from slice 0; no schema migration.

### 3.3 Drag/reorder & sizing
- **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`) — React 19 compatible, light,
  with built-in keyboard accessibility.
- Linear list reorder via `SortableContext` + `useSortable` per panel — no 2D
  collision math (the column-flow grid handles wrapping).
- Sizing maps to discrete Tailwind col-span classes (`xl:col-span-1 / 2 / 4` etc.) at
  the panel wrapper level.

### 3.4 DashboardGrid (data-driven)
- Reads `getEffectiveLayout()` from the store and edit-mode flag.
- Renders the panel grid by mapping each non-hidden item: wrap with
  `useSortable` only when edit-mode is on (zero drag-machinery cost outside edit
  mode), apply the col-span class, and call `registry.get(id).render(ctx)`.
- The KPI ticker stays above the customizable grid, unchanged.

### 3.5 Customize toggle + "Customize" UI
- A `useEditMode()` store hook (boolean) + a `<CustomizeButton/>` in the TopBar.
- A `<LayoutEditBar/>` (the top strip with the Done + Reset buttons) renders only in
  edit mode.

## 4. Demo Mode

`isDemoMode()` is irrelevant to the layout subsystem — it lives entirely in the
client/localStorage. The Customize feature is fully usable in demo; each visitor's
changes affect only their own browser, and the seeded data is untouched.

## 5. File Plan

- `src/lib/layout/types.ts` — `PanelSize`, `LayoutItem`, `LayoutState`, `PanelCtx`.
- `src/lib/layout/registry.ts` — registry + `getEffectiveLayout()`.
- `src/store/settings.ts` — extend with `dashboardLayout` + mutators + edit-mode flag.
- `src/components/dashboard/CustomizeButton.tsx` — toolbar toggle.
- `src/components/dashboard/LayoutEditBar.tsx` — the top edit-mode strip.
- `src/components/dashboard/SortablePanel.tsx` — wrapper applying dnd-kit + size class.
- `src/app/DashboardGrid.tsx` — refactor to render from the registry.
- `src/components/dashboard/TopBar.tsx` — host the Customize button.

## 6. Testing (TDD)

- **Registry:** every panel id has the right shape; default order matches today's
  grid; `render(ctx)` doesn't throw given a minimal ctx.
- **Store:** layout writes/reads via the existing localStorage seam; `reset` clears;
  `getEffectiveLayout` zero-fills (appends registry panels missing from persisted
  list, drops unknown ids).
- **Edit-mode toggle:** drag handles, size cycles, hide buttons render only in edit
  mode.
- **dnd-kit reorder:** simulated keyboard reorder updates the layout array (use the
  dnd-kit `keyboardSensor` test helpers).
- **Resize cycle:** clicking the size control walks the sequence and the wrapper's
  col-span class updates.
- **Hide/show + Reset:** mutate the store, observe the rendered grid.
- **Existing Dashboard test stays green** (non-edit-mode renders the same panel set
  in the default order).

## 7. Out of Scope

Free-form pixel resize; arbitrary 2D drop targets; per-breakpoint layouts; DB-backed
or per-org layouts; reordering KPI ticker / shell chrome; cross-page layouts;
exporting/importing layout presets.
