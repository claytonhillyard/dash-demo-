# AIYA Designs — Pixel Polish Audit (Mockup 1) — Slice 13 Scoping

**Date:** 2026-06-07
**Status:** Audit (read-only research dispatch)
**Audience:** This drives the scope/cut for Slice 13 (pixel-polish pass). NOT a plan/spec.
**Method:** Read-only review of the dashboard against the original AIYA "Mockup 1" intent.
**Author note:** Audit only — zero source edits. Every finding is a candidate, not a commitment.

---

## §1 Mockup reference + provenance

### 1.1 The mockup itself

**No bitmap or PDF of "Mockup 1" exists in the repo.** I searched:

- `docs/` (no `mockups/` subdirectory exists; only `superpowers/plans/` and `superpowers/specs/`).
- The project root (only `mobile-iphone.jpeg`, `mobile-drawer-open.jpeg`, `mobile-iphone-after.jpeg`, `FEMALE_AI_BOT.pdf` — none of which are the dashboard reference).
- The training-protocol PDFs (persona docs, not visual references).
- Any `public/` or asset directory inside `src/` (none with imagery).

The mockup PNG/PDF was apparently the user's external reference; only its *prose description* is preserved in the codebase, in:

- `docs/superpowers/specs/2026-05-24-aiya-designs-dashboard-slice-1a-design.md` — the canonical
  "Mockup 1" description (palette, layout, panel list, branding).
- `git log` — commit `c3a5aff` "feat(dashboard): assemble AIYA mockup-1 grid" and `e8cdd09`
  "feat(ui): luxury visual polish to match AIYA mockup" — the two original mockup-fidelity
  pushes. These are the reference points for the polish-pass aesthetic decisions already made.

**Audit fallback:** since no bitmap exists, this audit reads the dashboard against (a) the spec's
literal language ("mockup-exact dense AIYA-branded dashboard", "AMOLED base", "gold gradient
accent", "engraved serif wordmark", "hairline gold-bordered cards") and (b) generic
premium-jewelry-house cues (Tiffany/Cartier/Mikimoto-tier restraint: tabular numerics for
prices, hairline rules, controlled type scale, sparse accent color, no off-palette tones).

### 1.2 Last-revision provenance of the existing aesthetic

| Aspect | Source of truth | Last touched | Notes |
|---|---|---|---|
| Token palette | `src/app/globals.css:5-19` | commit `e8cdd09` (2026-05-25) | bg/surface/surface-2/border/gold/gold-deep/gold-soft/teal/text + accent-purple/blue/pink. AMOLED override at `[data-amoled="true"]`. |
| Surface chrome | `globals.css:60-70` `.surface-card` | `e8cdd09` | gradient + hairline border + inset top sheen + faint bottom shadow + hover gold-border. |
| Foil text | `globals.css:47-58` `.text-foil` | `e8cdd09` | wordmark/numerals only. |
| Gold rule | `globals.css:73-75` `.rule-gold` | `e8cdd09` | header underline. |
| Type stack | `src/app/layout.tsx:3-14` | `e8cdd09` | Inter (sans) + JetBrains Mono (mono) + Cormorant Garamond (display, weights 500/600/700). |
| Panel primitive | `src/components/Panel.tsx` | `e8cdd09` | title 11px / 0.18em tracking / uppercase, gold rule, freshness dot, action slot, unwired state. |
| Grid | `src/app/DashboardGrid.tsx:64` | slice 1c | `grid-cols-1 gap-3 xl:grid-cols-4`. |
| Background atmosphere | `globals.css:38-44` | `e8cdd09` | top-left gold aurora + bottom-right blue depth, fixed. |

### 1.3 Aesthetic decisions worth preserving (the "do not break this" list)

From CLAUDE.md memory + the slice-1a spec + commit messages:

1. **Honesty contract** — no fake numbers; `unwired` state is canonical for placeholders.
2. **AMOLED parity** — every change must look right under both default and `data-amoled="true"`.
3. **Reduce-motion respect** — `[data-reduce-motion="true"] *` disables animation/transition globally.
4. **Render isolation** — one symbol tick re-renders one cell (selector subscriptions). Visual
   changes must not introduce new re-render fanout.
5. **AIYA palette is the palette** — gold + bg/surface/surface-2 + border + ok/warn/bad +
   accent-purple/blue/pink. Anything in raw `zinc-*` / `amber-*` / `rose-*` / `emerald-*`
   is drift, not intentional.
6. **Engraved serif wordmark** — Cormorant Garamond + `text-foil`, not techno-geometric. The
   spec explicitly forbids Unicode-glyph substitution for headings (accessibility).
7. **"Mockup-exact dense"** — density was a non-negotiable in the spec. Polish must not
   reduce density to the point of feeling sparse.

---

## §2 Current state baseline

### 2.1 Dashboard chrome (rendered every load)

| Region | File | Aesthetic 1-liner |
|---|---|---|
| Left Nav | `src/components/dashboard/Nav.tsx` | Strong: brand lockup + account chip + Elite card + market-status widget. Weak: nav rows use unicode `•` dot, all sections render even though only 6 have real routes (the other 16 are non-interactive `<div>` rows with `cursor-default` — discoverable but a tease). |
| Top Bar | `src/components/dashboard/TopBar.tsx` | Greeting + search + customize + bell/mail glyphs + ticker + profile chip. Bell/mail are unicode emoji (🔔 ✉) not real icons — reads cheap in a "luxury" frame. |
| Demo Banner | `src/components/dashboard/DemoBanner.tsx` | Gold-tinted, restrained. Fine. |
| Ticker Strip (in TopBar) | `src/components/market/TickerStrip.tsx` | Dense mono, no tabular-nums → numerals jiggle on tick. |
| KPI Ticker (top of grid) | `src/components/market/KpiTicker.tsx` | 8-col grid, gold ring on Gold card, foil numerals. Polished but ▲/▼ are unicode arrows; numeric column not tabular. |
| Layout Edit Bar | `src/components/dashboard/LayoutEditBar.tsx` | Gold-tinted strip, appears only in edit mode. Inside the scroll container — scrolls away. |
| Grid container | `src/app/DashboardGrid.tsx:64` | `gap-3 xl:grid-cols-4`. Outer wrapper uses `space-y-3`. |
| Right Rail | `src/components/dashboard/RightRail.tsx` + `SettingsPanel.tsx` | 64-wide rail, hosts only a small Settings panel. **Looks empty** at desktop widths — visually unbalanced vs the left nav (60-wide, dense). |
| Footer Bar | `src/components/dashboard/FooterBar.tsx` | Two-symbol ticker + Dubai/All Systems Operational. Adequate; no rule above it (just `bg-surface`, sits next to scrollable content with no separator). |

### 2.2 Panel inventory (in default-layout order)

Every panel currently rendered on `/`:

| # | Panel | File | Aesthetic 1-liner |
|---|---|---|---|
| 1 | Market Intelligence | `src/components/market/MarketIntelligencePanel.tsx` | Tabs are plain text buttons with no underline/active indicator beyond color. Table rows use `border-b border-white/5` — a non-token color (drift). |
| 2 | Price Trend Analytics | `src/components/market/PriceTrendPanel.tsx` | Recharts line chart, fixed `h-56`. Range buttons use same plain-text style as tabs — no active state beyond color. |
| 3 | Calendar (Clock + Month) | `src/components/dashboard/ClockCalendar.tsx` | Strongest panel — time, weekday/month chip, weekday-aligned grid, today ring. Clean. |
| 4 | AI Insights | `BusinessPlaceholder` → `Panel` `unwired` | Honest placeholder. Fine. |
| 5 | Today's Schedule | `BusinessPlaceholder` → `Panel` `unwired` | Honest placeholder. Fine. |
| 6 | Inventory Overview | `src/components/dashboard/InventoryOverviewPanel.tsx` | 3-col category tiles, gold numerals, "Total items" footer. Solid. Numerals not tabular; tile padding tight (`px-2 py-2`). |
| 7 | Deal Room | `src/components/dashboard/DealRoomPanel.tsx` | List-style rows, BUY/SELL kind chips, circle badge, price, time-ago, unread/total chip, accordion toggle. **The unread chip uses 🔴 emoji + `text-rose-400` — palette drift.** Accordion content (`DealThreadAccordion`) is heavily off-palette (zinc/amber). |
| 8 | TradeNet Inventory | `src/components/dashboard/TradeNetInventoryPanel.tsx` | Clean divider list, modest. Looks consistent with Deal Room rows. |
| 9 | Website Overview | `src/components/dashboard/WebsiteOverviewPanel.tsx` | 2x2 KPI tile grid + sparkline + "owner-entered" footer. Density a bit too low for a `size: 2` panel — sparkline reads tiny. |
| 10 | Provider Status | `src/components/dashboard/ProviderStatusPanel.tsx` | **Does NOT use the `Panel` primitive** — bespoke `<div>` with its own `<h3>` heading style. No gold rule, no freshness dot in header, no `surface-card` chrome. Visually different from every other panel. |
| 11 | Today's Bids | `src/components/dashboard/TodaysBidsPanel.tsx` | **Does NOT use the `Panel` primitive** — bespoke `<div>` with `rounded border border-zinc-700 bg-zinc-900/40` (off-palette). Accept/Reject buttons use `bg-emerald-500/80` / `bg-zinc-700` — direct Tailwind palette, not theme tokens. |
| 12 | Orders & Pipeline | `BusinessPlaceholder` | Honest placeholder. |
| 13 | Portfolio Snapshot | `BusinessPlaceholder` | Honest placeholder. |
| 14 | Unit Converter | `src/components/converter/UnitConverterPanel.tsx` | Tabs + form inputs. `<select>` / `<input>` use raw `bg-bg p-1` with no border — looks like a debug control, not jewelry-house input chrome. |
| 15 | Crypto Wallet | `BusinessPlaceholder` | Honest placeholder. |
| 16 | Financial Overview | `BusinessPlaceholder` (size 2) | Honest placeholder. |
| 17 | Social & Inbox | `BusinessPlaceholder` (size 2) | Honest placeholder. |

### 2.3 In-accordion content (rendered inside Deal Room when a row is expanded)

| Sub-component | File | Aesthetic 1-liner |
|---|---|---|
| Deal Thread Accordion | `src/components/deals/DealThreadAccordion.tsx` | All zinc/amber/rose tones. Tabs use `bg-zinc-700`. Mode selector `<select>` is `bg-zinc-800`. The drift extends ~50 utility classes. |
| Deal Bids Tab | `src/components/deals/DealBidsTab.tsx` | Same zinc/amber drift. Bid status colors hardcoded to amber-300 / emerald-400 / zinc-500. |
| Deal Attachment Carousel | `src/components/deals/DealAttachmentCarousel.tsx` | Zinc/rose drift. Add-image button is `border-dashed border-zinc-700` — should be `border-gold/30` to match the AIYA brand. Lightbox uses `bg-zinc-900/95`. |
| Inventory Bids Tab | `src/components/inventory/InventoryBidsTab.tsx` | Mixed: status pill colors use `bg-amber-500/20 text-amber-200` / `bg-emerald-500/20` (off-palette), but accept/reject text buttons use `text-emerald-300` / `text-bad` (theme tokens). Inconsistent within one file. |

### 2.4 Aggregate metrics

- **Total panels on `/`:** 17 registered, default-visible 17, plus chrome (Nav, TopBar, KpiTicker, FooterBar, RightRail).
- **Panels not using the `Panel` primitive:** 2 (`TodaysBidsPanel`, `ProviderStatusPanel`).
- **Files containing off-palette tones (zinc/amber/rose/emerald-*):** 7 files, 67 occurrences.
- **`shadow-*` utility usage anywhere in `src/components`:** 0. (Only `.surface-card` has a `box-shadow` in `globals.css`.)
- **`focus-visible:` ring usage:** 0. (One `focus:outline-none` in TopBar's search disables the default ring with no replacement.)
- **`tabular-nums` usage anywhere:** 0. (27 `font-mono` usages, all without `tabular-nums`.)
- **`lucide-react` (or any icon library) in `package.json`:** Not installed. All icons are unicode glyphs (☰ ⌕ ⠿ ▲ ▼ ♛ ✕ 🔔 ✉ 🔴 💬 📄 ▾ ▸ ⌕ ⠿).
- **`transition` utility usage:** 4 files (Nav, LogoutButton, SortablePanel, CustomizeButton). Most state transitions are instant.

---

## §3 Gap analysis — bucketed

Each finding follows: **File:line — Issue — Current — Fix — Cost**.

---

### 🔴 High-impact (worth a dedicated Slice 13 polish pass)

These show up everywhere or break the brand feel. The dashboard cannot read "premium" until they're fixed.

#### H1. Off-palette tones throughout the deals/bids stack
- **Files:** `src/components/deals/DealThreadAccordion.tsx` (lines 125, 133, 138, 146, 165, 179, 184, 191, 202, 205, 222, 240, 248, 254), `src/components/deals/DealBidsTab.tsx` (lines 29-33, 55-79, 87-99), `src/components/deals/DealAttachmentCarousel.tsx` (lines 61, 85, 106, 120, 134, 141, 195, 217), `src/components/dashboard/TodaysBidsPanel.tsx` (lines 20-23, 33-41, 50-60), `src/components/dashboard/DealRoomPanel.tsx:193-196` (rose-400 unread badge), `src/components/inventory/InventoryBidsTab.tsx:19-25`, `src/components/inventory/TradeNetInventoryList.tsx:41`.
- **Issue:** 67 instances of raw Tailwind palette (`zinc-*`, `amber-*`, `rose-*`, `emerald-*`) across 7 files. These were introduced in slices 10/16/17/18 without going through the AIYA token system.
- **Current:** e.g. `DealThreadAccordion.tsx:125`: `className="rounded border border-zinc-700 bg-zinc-900/40 p-3"`.
- **Fix:** Map every off-palette tone to AIYA tokens:
  - `bg-zinc-900/40` → `bg-surface-2/40`
  - `border-zinc-700` / `border-zinc-800` → `border-border`
  - `text-zinc-100` / `text-zinc-200` → `text-text`
  - `text-zinc-300` / `text-zinc-400` → `text-text/80` / `text-text/60`
  - `text-zinc-500` → `text-text/40`
  - `text-rose-400` → `text-bad`
  - `text-emerald-400` / `text-emerald-300` → `text-ok`
  - `text-amber-300` → `text-warn` (or `text-gold/80` for pending-bid pills, since amber == pending == gold in our system)
  - `bg-emerald-500/80` (accept button) → `bg-ok/80` with `hover:bg-ok` and `text-bg` for legibility
  - `bg-amber-500/80` (send button) → `bg-gold/80` with `hover:bg-gold` and `text-bg`
  - `bg-zinc-700` (reject button) → `bg-surface-2` with `border border-border`
  - `bg-zinc-900/95` (lightbox) → `bg-bg/95`
- **Cost:** ~80–120 LoC across 7 files. Mostly mechanical search-replace. Risk: **low** for the file-by-file token swap; **medium** for the accept/send button color change (CSS-only test snapshots may match on literal class strings, so component tests for `DealBidsTab`, `TodaysBidsPanel`, `InventoryBidsTab` need a quick scan for class assertions).

#### H2. Two panels bypass the `Panel` primitive entirely
- **Files:** `src/components/dashboard/TodaysBidsPanel.tsx:20` and `src/components/dashboard/ProviderStatusPanel.tsx:27`.
- **Issue:** Both panels are rendered inside `SortablePanel` (which is just a positioning wrapper — no chrome), so they render WITHOUT the gold rule, the `surface-card` gradient/sheen/border, the uppercase tracked title style, the action slot, or the freshness/loading/empty states. They look like generic cards next to 15 other panels that share a coherent chrome.
- **Current:** `TodaysBidsPanel` opens with `<div aria-label="todays bids panel" className="rounded border border-zinc-700 bg-zinc-900/40 p-3"><h3 className="text-sm font-semibold text-zinc-200 mb-2">Today's Bids</h3>...`. `ProviderStatusPanel` opens with `<div data-testid="panel-provider-status" className="flex flex-col gap-2"><h3 className="text-sm font-medium text-text/80">Provider Status</h3>...`.
- **Fix:** Wrap both bodies in `<Panel title="Today's Bids" state="ready"> ... </Panel>` / `<Panel title="Provider Status" state="ready"> ... </Panel>`. Strip the bespoke `<h3>` headings. For TodaysBidsPanel, also handle the empty-state case via `state="empty"` (or keep ready + inline empty message — either is fine but be consistent with `InventoryOverviewPanel` which uses `state="ready"` + inline empty text).
- **Cost:** ~10 LoC per file. Risk: **low**. Existing component tests for both look up by `aria-label`/role rather than DOM structure (verified by spot-check); the `Panel` primitive renders the same `<section>` tag. Demo banner is fine.

#### H3. No `tabular-nums` anywhere → numerals jiggle on tick
- **Files:** `KpiTicker.tsx:35,58`, `TickerStrip.tsx:16`, `MarketIntelligencePanel.tsx:29,64`, `FooterBar.tsx:14`, `DealRoomPanel.tsx:190`, `InventoryOverviewPanel.tsx:35,41`, `WebsiteOverviewPanel.tsx:42`, `ClockCalendar.tsx:32`, `UnitConverterPanel.tsx:38,84`, `ProviderStatusPanel.tsx:38`, `TodaysBidsPanel.tsx:33`, `InventoryBidsTab.tsx:85`, `DealBidsTab.tsx:97`, `Sparkline.tsx` (n/a), `TradeNetInventoryList.tsx` (no prices yet).
- **Issue:** Every `font-mono` numeric cell uses proportional digits, so a `2` (narrow) and `0` (wide) tick changes the column width. On the KPI ticker this is a visible micro-shudder every poll cycle. On dense tables (Market Intelligence rows) it makes the column edge wave.
- **Current:** `<div className="font-mono text-lg text-text">...</div>`.
- **Fix:** Append `tabular-nums` to every `font-mono` numeric cell. Better: define a `.num` utility in `globals.css` (`font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: 0;`) and replace `font-mono` → `num` in the ~27 numeric callsites.
- **Cost:** 1 LoC in `globals.css` + ~27 mechanical replaces. Risk: **low**. Pure presentational. No test impact (tests assert on text content, not font).

#### H4. Type scale is informal — no token system
- **Files:** All panels. Sample mismatches: `Panel.tsx:21` title is `text-[11px] ... uppercase tracking-[0.18em]`; `DealRoomPanel.tsx:144` subtitle is `text-[10px] uppercase tracking-widest`; `WebsiteOverviewPanel.tsx:41` KPI label is `text-[10px] uppercase tracking-wider`; `KpiTicker.tsx:31` label is `text-[9px] uppercase tracking-wider`; `BusinessPlaceholder` via Panel `unwired` subtitle is `text-[10px] uppercase tracking-widest`; `InventoryOverviewPanel.tsx:36` category label is `text-[10px] uppercase tracking-wider`.
- **Issue:** Three sizes (9/10/11 px) and three tracking values (0.05em-ish "wider", 0.1em-ish "widest", 0.18em explicit) compete with no rule for which to use where. The eye sees small differences as inconsistencies rather than hierarchy.
- **Current:** Arbitrary `text-[Xpx]` literals scattered. Tracking utilities chosen ad hoc.
- **Fix:** Establish 4 type roles as global utility classes in `globals.css`:
  - `.t-panel-title` — `text-[11px] font-medium uppercase tracking-[0.18em] text-text/70` (matches Panel)
  - `.t-eyebrow` — `text-[10px] uppercase tracking-[0.16em] text-text/45` (use for KPI labels, category labels, panel subtitles, footer chrome)
  - `.t-micro` — `text-[10px] tracking-wider text-text/40` (use for "time ago" / "updated 2d ago" / provenance)
  - `.t-display-num` — `font-mono tabular-nums text-base text-text` (use for numeric cells, with `text-gold` / `text-foil` for emphasis variants)
  Then sweep panels to use these instead of inline literals. Goal: every panel header on the grid should have the same first-glance type weight; KPI labels should all read as the same role.
- **Cost:** ~6 LoC of new utilities + ~20-40 LoC of in-component swaps across the panels. Risk: **medium**. Snapshot tests will not break (text content unchanged) but any test asserting on a literal class string (e.g. `expect(el).toHaveClass("text-[10px]")`) needs a sweep. Visual review needed.

#### H5. KPI Ticker arrow glyphs (▲/▼) read cheap; no icon system
- **Files:** `KpiTicker.tsx:39,61`, `MarketIntelligencePanel.tsx:31,66`, `WebsiteOverviewPanel.tsx:20-23`, `DealRoomPanel.tsx:212` (`▾ / ▸` accordion chevrons), `TopBar.tsx:14,32,44,47` (hamburger, search, bell, mail), `Nav.tsx:62`, `LayoutEditBar`, `DemoBanner`.
- **Issue:** Unicode arrows render in the system font with no weight/scale control, varying baseline alignment, and inconsistent sizing across browsers. Bell/mail in TopBar are emoji (color glyphs) — they break the dark-luxury monochrome by rendering full-color in WebKit. The slice-1a spec explicitly forbade unicode-glyph substitution for accessibility — same logic applies to UI affordances.
- **Current:** `<span aria-hidden>🔔</span>`, `<span aria-hidden>⌕</span>`, `<span>▲ 2.41%</span>`, etc.
- **Fix:** Add `lucide-react` (~3KB tree-shaken; a single Inter-spirited icon set, MIT). Replace:
  - ▲/▼ → `<ArrowUp className="h-3 w-3" />` / `<ArrowDown className="h-3 w-3" />` (uses `currentColor`, so ok/bad token still drives color)
  - 🔔/✉ → `<Bell className="h-4 w-4" />` / `<Mail className="h-4 w-4" />` with `text-text/40`
  - ⌕ (search) → `<Search className="h-3.5 w-3.5" />`
  - ☰ (menu) → `<Menu className="h-5 w-5" />`
  - ♛ (crown) → keep (display serif glyph, intentional, and it's branded)
  - ▾/▸ (accordion) → `<ChevronDown />` / `<ChevronRight />`
  - ⠿ (drag handle) → `<GripVertical className="h-3.5 w-3.5" />`
  - ✕ → `<X className="h-3.5 w-3.5" />`
  - 🔴 (unread dot) → custom `<span className="h-1.5 w-1.5 rounded-full bg-bad" />`
  - 💬 (message count) → `<MessageSquare className="h-3 w-3" />`
  - 📄 (cert) → `<FileText className="h-4 w-4" />`
- **Cost:** ~30 LoC additions, ~15 LoC removals; one new dep. Risk: **low**. Lucide is stable; the icon set is monochrome SVG so AMOLED parity is automatic. Tests that match icon literals (e.g. on the menu button) need an aria-label-based selector (most already use `aria-label`).

#### H6. Buttons have no focus-visible affordance — accessibility regression
- **Files:** `LogoutButton.tsx:18`, `CustomizeButton.tsx:10`, `Nav.tsx:57`, `TopBar.tsx:11,30`, `LayoutEditBar.tsx:12`, every interactive `<button>` in deals/bids panels, `SortablePanel.tsx:42,50,57`.
- **Issue:** No button declares a `focus-visible:ring-*` style. The TopBar search input actively suppresses focus outline with `focus:outline-none` and provides nothing in its place. Keyboard users have no way to see where focus is. (axe rule "focus-visible".)
- **Current:** Buttons like `<button className="rounded-full border border-border px-3 py-1 text-[11px]...">` — no focus styles.
- **Fix:** Add a base focus-ring policy in `globals.css`:
  ```css
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 2px solid hsl(var(--gold) / 0.7);
    outline-offset: 2px;
    border-radius: inherit;
  }
  ```
  (Plus a class escape-hatch `.no-focus-ring` for the rare cell where it's wrong.)
- **Cost:** ~6 LoC CSS. Risk: **low**, but visual: gold ring on every focused interactive element. Verify it reads right against gold-accent buttons (may want `outline-color: hsl(var(--gold) / 0.4)` on already-gold-bordered controls). No test impact.

#### H7. RightRail is sparse — visual imbalance vs left Nav
- **File:** `src/components/dashboard/RightRail.tsx`, called from `Shell.tsx:61` with only `<SettingsPanel />` as content.
- **Issue:** Left Nav is 240px (`w-60`) and densely packed (brand lockup, account chip, 22 section rows, Elite card, market-status, logout). Right Rail is 256px (`w-64`) and contains a single 4-row SettingsPanel taking ~25% of its height — the rest is empty bg-surface. The result is a heavy left, hollow right, which makes the dashboard feel uncentered.
- **Current:** RightRail is essentially "<Settings panel> + 75% empty column".
- **Fix:** Either (a) make it useful — pull `ProviderStatusPanel` and `TodaysBidsPanel` into the right rail by default (these are operational rather than dashboard content, and would balance the left's "what is this" with right's "what's happening"); OR (b) shrink it to `w-48` and add a content density (Recent Activity microfeed, or move the `MarketStatus` widget out of Nav and into here, since "Market Status" reads as right-rail telemetry). Recommended: (a) is lower-effort and immediately fixes the imbalance.
- **Cost:** ~20 LoC if (a) — move two registry entries from grid to right-rail injection; right-rail accepts `ReactNode[]`. Risk: **medium** — changes the layout customization story (the user can no longer drag those two panels). Worth a separate decision before slice 13 commits to this.

#### H8. LayoutEditBar scrolls away with the grid
- **File:** `src/app/DashboardGrid.tsx:87`, `LayoutEditBar.tsx`.
- **Issue:** In edit mode, the edit bar ("Customize layout — drag to reorder · resize · hide / Reset to default") is the first child of the `space-y-3` wrapper INSIDE the scroll container (`main` is `overflow-auto`). When the user scrolls down to drag a panel from row 4, the edit affordance disappears. There's no "Done" affordance visible either, only the one in the TopBar.
- **Current:** Static positioning, scrolls with grid.
- **Fix:** Make the bar `sticky top-0 z-10` within the scroll container; or, lift it to render above the grid container in `Shell` so it sits between TopBar and the grid scroll area. Sticky is the minimal-change fix.
- **Cost:** 3 LoC. Risk: **low**. Existing edit-mode tests pass on visibility, not position.

#### H9. `border-white/5` and other ad-hoc opacity dividers leak through
- **Files:** `MarketIntelligencePanel.tsx:27,62` (`border-b border-white/5`).
- **Issue:** `white/5` is a Tailwind palette artifact (raw white at 5% alpha), not a token. On AMOLED it reads as a `hsla(0,0%,100%,0.05)` line; on the default near-black it reads similar but slightly more visible because surface is 5% lightness, not 0%. Either way, the panel has different divider styling than every other list panel (which uses `divide-y divide-text/10`).
- **Current:** `<tr key={sym} className="border-b border-white/5">`.
- **Fix:** Switch table to `<tr className="border-b border-text/10">` (or move to `<ul className="divide-y divide-text/10">` for parity with DealRoom/TradeNet rows — but that requires removing the `<table>` semantics, so the border-token swap is the minimal fix).
- **Cost:** 2 LoC. Risk: **low**.

#### H10. Panel `unwired` placeholder is too small — voids feel like bugs
- **File:** `Panel.tsx:33-42`.
- **Issue:** "Not yet wired" + "Coming in a future slice" appears in italic `text-text/30` and tiny `text-[10px]` uppercase, centered in the panel. With the surrounding panel chrome (gold rule, title) reading as "real", the empty body looks broken/loading rather than intentional. In a "honest placeholder" design, the placeholder should look as designed as the wired panels do — like a wireframe sketch, not a void.
- **Current:** Centered italic text only.
- **Fix:** Add a faint icon (e.g. `<Construction />` or `<Sparkles />` at `h-4 w-4 text-text/15`) above the text + a dashed-outline rectangle (`border border-dashed border-text/10 rounded-lg`) sized like a wireframe content block, so the panel reads as "intentionally pending" rather than "broken".
- **Cost:** ~10 LoC in `Panel.tsx`. Risk: **low**. The 6+ panels currently in `unwired` state benefit. No test impact.

---

### 🟡 Medium-impact (worth doing but not urgent)

#### M1. Nav section rows: 16 of 22 are dead `<div>` with `cursor-default`
- **File:** `Nav.tsx:54-77`.
- **Issue:** The nav lists 22 sections (Dashboard … Settings); only 6 have real routes (Inventory, Diamonds, Website, Circles, Orders & Deals, TradeNet Exchange). The rest render as `<div ... cursor-default>` — they look identical to links but do nothing on click. This is *cursor-honest* but reads as inert UI.
- **Fix:** Add an explicit "coming soon" affordance on inactive rows — e.g. a tiny `<Lock className="h-3 w-3 text-text/20" />` icon on the right, or `text-text/35` (vs current `text-text/65`) so they read as preview rather than peer.
- **Cost:** ~5 LoC. Risk: low.

#### M2. Tab strips lack active-indicator underlines
- **Files:** `MarketIntelligencePanel.tsx:47-52` (Gold/Metals/Crypto/Diamonds/Gas/News), `PriceTrendPanel.tsx:50-54` (1D/7D/1M/3M/1Y/ALL), `UnitConverterPanel.tsx:101-106` (Metals/Currency/Weight/Diamonds/Gas), `DealThreadAccordion.tsx:133-149` (Messages/Bids).
- **Issue:** Active tab is conveyed only by `text-gold` vs `text-text/50` — no underline, no indicator bar. Three of the four tab strips look like plain colored buttons rather than tabs.
- **Fix:** Standardize a `.tab` / `.tab-active` pair: `text-text/50 hover:text-text/80 pb-1 border-b-2 border-transparent` / `text-gold border-gold`. Apply to all four tab strips. Optional: animate `border-b-2` color on transition.
- **Cost:** ~20 LoC across 4 files. Risk: low.

#### M3. Sparkline is tiny — `w-96 h-28` hardcoded
- **Files:** `Sparkline.tsx:11`.
- **Issue:** Sparkline is hardcoded to 96×28 px (the original "tiny inline" use case). The Website Overview panel embeds it at `mt-2` after a 2x2 KPI grid in a `size: 2` panel — there's plenty of room, but it stays 96px wide, looking like an afterthought.
- **Fix:** Accept `width`/`height` props with defaults of `96 / 28`; in `WebsiteOverviewPanel` pass `width: 320, height: 56` (or use `ResponsiveContainer` from recharts since it's already a dependency).
- **Cost:** ~10 LoC across 2 files. Risk: low (already memoized by `points`).

#### M4. Drag handle uses `cursor-grab` but no drag preview / lift effect
- **File:** `SortablePanel.tsx:26-30,42-47`.
- **Issue:** During drag, only `opacity: 0.55` is applied to the lifting panel. There's no scale, no shadow lift, no ring color shift on hover-over-target. dnd-kit makes this trivial; the current effect reads as "is this loading?" rather than "is being moved."
- **Fix:** Replace the inline `style={{ opacity: isDragging ? 0.55 : 1 }}` with:
  ```jsx
  style={{
    transform: isDragging ? `${CSS.Transform.toString(transform)} scale(1.02)` : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    boxShadow: isDragging ? "0 16px 32px -8px hsl(var(--gold) / 0.25), 0 0 0 1px hsl(var(--gold) / 0.4)" : undefined,
    zIndex: isDragging ? 10 : undefined,
  }}
  ```
- **Cost:** ~10 LoC. Risk: low. Respect `reduce-motion` — wrap the scale/shadow in a `prefers-reduced-motion` check or use the existing `[data-reduce-motion="true"] *` global (already in globals.css covers transition).

#### M5. Settings panel checkbox / select chrome unstyled
- **File:** `SettingsPanel.tsx:11,15,21,30`.
- **Issue:** Native checkboxes and `<select>` render in browser-default chrome on dark backgrounds — checkbox is white, select chevron is unstyled. Looks unfinished.
- **Fix:** Apply minimal Tailwind chrome: `<input type="checkbox" className="h-4 w-4 rounded border-border bg-surface-2 accent-gold" />` (the `accent-gold` is a CSS standard for native checkbox tint); `<select className="rounded border border-border bg-surface-2 px-1 py-0.5 text-text">`.
- **Cost:** ~6 LoC. Risk: low.

#### M6. Unit Converter inputs unstyled
- **File:** `UnitConverterPanel.tsx:28-35,72-82`.
- **Issue:** `<input className="w-20 bg-bg p-1">` and `<select className="bg-bg p-1">` have no border, no rounding, no padding refinement. The Currency tab has the worst case — `from → to` reads like a debug form.
- **Fix:** Apply a small `.input-chrome` utility (`rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text focus-visible:border-gold/40`) and use it on all converter inputs.
- **Cost:** ~10 LoC (+1 utility def). Risk: low.

#### M7. Top bar profile chip "AD" monogram only — name truncates on tablet
- **File:** `TopBar.tsx:51-55`.
- **Issue:** Profile chip is `rounded-full border border-border bg-surface-2/60 py-1 pl-1 pr-3` with the "AD" badge + "AIYA Designs" name. On medium widths it stays visible but is cramped against the ticker. On small `lg` viewports the name disappears (`hidden sm:block`) so it becomes a hovering "AD" pill with no label — looks orphaned.
- **Fix:** Add a tiny `<ChevronDown className="h-3 w-3 text-text/40" />` after the name so the pill reads as a "profile menu" affordance even when collapsed.
- **Cost:** ~3 LoC. Risk: low.

#### M8. Status pill system is inconsistent across deal/bid surfaces
- **Files:** `DealRoomPanel.tsx:182-189` (circle visibility badge: `rounded-full border border-gold/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-gold/80`), `TradeNetInventoryList.tsx:31-36` (same), `InventoryBidsTab.tsx:19-25` (status pill: `rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider` + per-status bg/text), `DealBidsTab.tsx:27-35` (text-only colored token, no pill), `TradeNetInventoryList.tsx:39-43` (sold badge: `rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300`).
- **Issue:** Five different status-pill styles for what is conceptually one badge family: visibility / bid-status / sold. Different padding (1.5 vs 2), different text sizes (9 vs 10), different shapes (pill vs text-only).
- **Fix:** Define one `.pill` base utility: `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider`. Then 4 variant utilities (or class composition): `.pill-gold` (border-gold/30 text-gold/80), `.pill-pending` (bg-warn/20 text-warn), `.pill-accepted` (bg-ok/20 text-ok), `.pill-neutral` (bg-text/10 text-text/50). Apply across all status-bearing badges.
- **Cost:** ~10 LoC utility defs + ~20 LoC sweep. Risk: medium (tests assert on specific classes for badge color in `InventoryBidsTab` snapshot).

#### M9. Footer bar lacks a top hairline
- **File:** `FooterBar.tsx:10`.
- **Issue:** `<footer className="flex items-center gap-6 bg-surface px-4 py-1 text-xs text-text/60">` has no border-top, so it abuts the scroll content with no separator. Reads as bleed-through.
- **Fix:** Add `border-t border-border` to the footer.
- **Cost:** 1 LoC. Risk: low.

#### M10. Demo banner sits between Shell and TopBar — vertical rhythm break
- **File:** `Shell.tsx:55-56`.
- **Issue:** When `isDemoMode()` is true, `<DemoBanner />` renders above `<TopBar />`, pushing the entire frame down by 22px. The banner uses `bg-gold/15` which clashes with the TopBar's `bg-surface/80 backdrop-blur`. A persistent demo banner should feel integrated, not stacked.
- **Fix:** Move the demo banner inline into TopBar's right-side cluster as a `<Pill variant="warning">DEMO</Pill>` chip; OR keep it where it is but apply `bg-gradient-to-b from-gold/15 to-transparent` so it blends into the TopBar surface.
- **Cost:** 5 LoC. Risk: low.

#### M11. KPI ticker — Diamond placeholder cards visually identical to wired cards
- **File:** `KpiTicker.tsx:46-54`.
- **Issue:** The diamond placeholder card uses `surface-card rounded-xl border-dashed px-3 py-2 opacity-80` — the `border-dashed` only applies after Tailwind upgrades because `.surface-card` sets a solid border that wins specificity. The dashed cue isn't visible.
- **Current:** dashed border doesn't render due to .surface-card precedence.
- **Fix:** Add `!border-dashed` or reorder — set the border-style on the inline element with !important, or refactor `surface-card` to use `border-style: var(--card-border-style, solid)` and then variants pass `style={{ '--card-border-style': 'dashed' }}`.
- **Cost:** ~3 LoC. Risk: low.

#### M12. PriceTrend chart has no axis labels or hover legend
- **File:** `PriceTrendPanel.tsx:63-76`.
- **Issue:** Three series (Gold, BTC, Diamond) all hidden axes + default Recharts tooltip. The user can't tell which line is which by color alone (gold, blue, pink) without a legend, and the tooltip renders in default Recharts white-on-white styling.
- **Fix:** Add a tiny inline legend chip above the range buttons:
  ```jsx
  <span className="ml-auto flex items-center gap-2 text-[10px]">
    <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-gold" />Gold</span>
    <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-accent-blue" />BTC</span>
    <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-accent-pink" />Dia.</span>
  </span>
  ```
  And style the Recharts `<Tooltip />` with `contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", color: "hsl(var(--text))" }}`.
- **Cost:** ~15 LoC. Risk: low.

#### M13. KPI ticker featured Gold card — gold ring renders inconsistently with hover
- **File:** `KpiTicker.tsx:24-30`.
- **Issue:** Featured Gold card uses `ring-1 ring-gold/30`, but `.surface-card:hover` (globals.css:68-70) sets `border-color: hsl(var(--gold) / 0.25)`. On hover, the featured card has both a ring and a gold border, which doubles the gold treatment and reads as two parallel rings.
- **Fix:** On featured cards, suppress the hover border via `.surface-card.featured:hover { border-color: hsl(var(--border)); }` — or remove the ring and let hover handle it, or remove hover border-change on featured (intentional steady-state for the highlight).
- **Cost:** ~3 LoC. Risk: low.

#### M14. Inventory category tiles — counts read as small bold, not as the panel's headline
- **File:** `InventoryOverviewPanel.tsx:35`.
- **Issue:** `<div className="font-mono text-base text-gold">` — `text-base` (16px) is "body" size. The inventory category tile should anchor on its count as the dominant glyph, e.g. `text-xl tracking-tight font-semibold`. Otherwise the label dominates the tile visually.
- **Fix:** Bump count to `text-lg font-semibold tabular-nums` and shrink label slightly (already `text-[10px]`).
- **Cost:** ~2 LoC. Risk: low.

#### M15. Website Overview KPI tiles look identical to Inventory Overview tiles but render differently
- **Files:** `InventoryOverviewPanel.tsx:33-38` (`rounded-lg border border-border bg-surface-2/40 px-2 py-2 text-center`) vs `WebsiteOverviewPanel.tsx:39-45` (`rounded-lg border border-border bg-surface-2/40 px-3 py-2`).
- **Issue:** Same tile concept, slightly different padding (`px-2` vs `px-3`) and one is centered, the other left-aligned with a delta line below. Reuse opportunity.
- **Fix:** Extract a `<MetricTile label value delta align?>` shared component; both panels use it. Single source of truth for tile chrome.
- **Cost:** ~25 LoC new component + ~10 LoC sweep. Risk: low.

---

### 🟢 Low-impact / nice-to-have

#### L1. Footer ticker has no FreshnessDot ARIA label
- **File:** `FooterBar.tsx:20`. Each `FreshnessDot` has `title={freshness}` from its source, but no `aria-label`. Screen readers skip the dot.
- **Fix:** Add `aria-label={\`Data freshness: ${freshness}\`}` to FreshnessDot itself. Cost: 1 LoC. Risk: low.

#### L2. Top bar "Good Morning" doesn't change with local time
- **File:** `TopBar.tsx:19`. Hardcoded "Good Morning, AIYA". At 7pm it reads odd.
- **Fix:** Compute greeting from `new Date().getHours()` in a tiny client wrapper; or move it server-side via `Intl.DateTimeFormat` with the user's TZ. Cost: ~10 LoC. Risk: low. (`'use client'` already present.)

#### L3. Calendar day cells don't darken on hover
- **File:** `ClockCalendar.tsx:47-58`.
- **Fix:** Add `hover:bg-surface-2 transition-colors` to each `<span>`. Cost: 1 LoC. Risk: low.

#### L4. Deal Room price column has no right-alignment in the row
- **File:** `DealRoomPanel.tsx:190`. Price sits as a flex item, not in a column — on long subjects it slides around.
- **Fix:** Wrap price + time-ago in `<div className="flex shrink-0 items-baseline gap-2 w-32 justify-end">` so they form a stable right column. Cost: 5 LoC. Risk: medium (changes visual rhythm; verify with multiple-deal seed).

#### L5. "View all" deal-room action link uses `text-text/40` — too faint
- **File:** `DealRoomPanel.tsx:117-119,138-140`.
- **Issue:** "VIEW ALL" link reads almost invisible on dark surface — `text-text/40` at `text-[10px]`. Hover state goes gold but the affordance is too quiet for the panel's "scan for unread" use case.
- **Fix:** Bump to `text-text/60` baseline, keep gold on hover. Cost: 1 LoC. Risk: low.

#### L6. Layout edit-mode controls float above the panel without spacing protection
- **File:** `SortablePanel.tsx:38-41`. Edit-mode toolbar uses `absolute -top-2 right-2` — on the topmost row it overlaps the KpiTicker.
- **Fix:** Add a small top-padding to the dashboard grid container in edit mode (`pt-4` conditional), or shift the toolbar to `top-1 right-1` so it stays inside the panel bounds. Cost: 3 LoC. Risk: low.

#### L7. AiyaLogo SVG uses an absolute facet-line `stroke="hsl(222 30% 6%)"`
- **File:** `AiyaLogo.tsx:29`. The facet stroke is hardcoded to the default bg color. In AMOLED (bg → `0 0% 0%`) the facet lines disappear into the background.
- **Fix:** Use `stroke="hsl(var(--bg))"` so AMOLED swaps it automatically. Cost: 1 LoC. Risk: low. (Visual: facet lines remain visible against the gradient gem; on AMOLED they become pure black instead of dark slate — should still register.)

#### L8. KPI ticker grid breakpoint jump
- **File:** `KpiTicker.tsx:69`. `grid-cols-2 md:grid-cols-4 xl:grid-cols-8` — at mid sizes (1024px) it shows 4 cards over 2 rows. On a 13" laptop (≈1280px which is `xl:` in default Tailwind), it becomes 8 cards in a single row but each is very narrow. The labels truncate (`text-[9px]` + `truncate`) — "Bitcoin (BTC/USD)" gets cut.
- **Fix:** Add `lg:grid-cols-4` and let xl be `xl:grid-cols-8`. Or move the breakpoint up: use `2xl:grid-cols-8`. Cost: 1 LoC. Risk: low.

#### L9. `TradeNetInventoryPanel` row "×N" quantity reads like multiplication
- **File:** `TradeNetInventoryPanel.tsx:21`. `<span className="text-text/60">×{it.quantity}</span>` reads as "×3" which evokes "times three" not "three units". OK in context but jewelry-house copy would say "Qty 3".
- **Fix:** `Qty {it.quantity}` with `text-[10px] uppercase tracking-wider text-text/40`. Cost: 1 LoC. Risk: low. (Copy decision — confirm with user.)

#### L10. Demo banner contrast on AMOLED
- **File:** `DemoBanner.tsx:6`. `bg-gold/15` on pure-black AMOLED reads almost invisible.
- **Fix:** Bump to `bg-gold/25` or add a `text-gold` border-bottom hairline. Cost: 1 LoC. Risk: low.

#### L11. `Panel` `state="loading"` is "Loading…" with `animate-pulse` on the text only
- **File:** `Panel.tsx:29`. Reads as broken text rather than skeleton.
- **Fix:** Replace with a 2-3 line skeleton: `<div className="space-y-2"><div className="h-3 w-2/3 rounded bg-surface-2 animate-pulse" /><div className="h-3 w-1/2 rounded bg-surface-2 animate-pulse" /></div>`. Cost: 5 LoC. Risk: low. (No current callsite passes `state="loading"` but it would matter when slice 1b/19 wires real loading.)

#### L12. `Panel` `state="empty"` is "No data" — same problem as L11
- **File:** `Panel.tsx:31`. Cold text. Inventory + Deal panels override with their own empty messages, but the default is stark.
- **Fix:** Use `state="empty"` with a faded icon + helpful copy prop. Cost: 5 LoC. Risk: low.

#### L13. CustomizeButton uses literal checkmark "✓ Done"
- **File:** `CustomizeButton.tsx:16`.
- **Fix:** Replace with `<Check className="h-3 w-3" /> Done`. Cost: 1 LoC. Risk: low. (Folds into H5.)

#### L14. Drag handle `⠿` has no resting affordance
- **File:** `SortablePanel.tsx:47`. Reads only on hover/focus. New users in edit-mode won't know they can grab anywhere.
- **Fix:** When in edit mode, set entire panel chrome to `cursor: grab` with a hairline gold border (already done via `ring-1 ring-gold/30`). Make the handle pulse once on enter-edit-mode. Cost: ~10 LoC. Risk: medium (motion adds noise; check reduce-motion).

#### L15. Nav "Verified Member" pill — checkmark would help
- **File:** `Nav.tsx:47-49`. Currently a dot + "Verified Member". A `<BadgeCheck className="h-3 w-3" />` reads stronger.
- **Fix:** Swap dot for icon. Cost: 1 LoC. Risk: low. (Folds into H5.)

---

## §4 Recommended Slice 13 cut

A coherent ~8-task slice that elevates the dashboard the most. Order is dependency-aware: tokens / utilities first, then sweeps.

### Task 1 — Establish type-scale utilities (foundation)
- **Files touched:** `src/app/globals.css` (additions only).
- **Adds 4 utilities:** `.t-panel-title`, `.t-eyebrow`, `.t-micro`, `.num`. Source of truth for type scale + tabular numerics.
- **Tests:** None new. Existing component tests don't assert on `.t-eyebrow` etc.
- **Acceptance:** New utility classes exist in `globals.css`; `npm run build` green; `npm test` green.

### Task 2 — Sweep theme tokens across deal/bid/inventory components (closes H1)
- **Files touched:** `DealThreadAccordion.tsx`, `DealBidsTab.tsx`, `DealAttachmentCarousel.tsx`, `TodaysBidsPanel.tsx`, `DealRoomPanel.tsx` (just lines 193-196), `InventoryBidsTab.tsx`, `TradeNetInventoryList.tsx`.
- **Maps:** zinc/amber/rose/emerald → AIYA tokens per H1 table.
- **Tests:** Existing snapshot/class-assertion tests for these components need a sweep. Specifically `test/components/dashboard/TodaysBidsPanel.test.tsx`, `test/components/deals/DealThreadAccordion.test.tsx`, `test/components/deals/DealBidsTab.test.tsx`, `test/components/inventory/InventoryBidsTab.test.tsx` — verify they assert by `aria-label` / role / text content (not literal class strings); update any that assert on `text-amber-300` etc.
- **Acceptance:** `grep -E "(zinc-|amber-|emerald-|rose-)" src/components` returns 0 results. AMOLED and default both render without "non-AIYA color" cells.

### Task 3 — Wrap the two bespoke panels in the `Panel` primitive (closes H2)
- **Files touched:** `TodaysBidsPanel.tsx`, `ProviderStatusPanel.tsx`.
- **Adds:** `<Panel title="..." state="ready">` wrapper; remove bespoke `<h3>` headings; map empty-state to a `state="empty"` (or keep ready + inline copy, matching `InventoryOverviewPanel`).
- **Tests:** Verify panel-level a11y tests in `test/components/Shell.test.tsx` still pass; the two panels gain the gold-rule + Panel chrome.
- **Acceptance:** Inspecting the grid in browser, all 17 panels share the same chrome (`.surface-card` + gold rule + uppercase tracked title). No "different chrome" panel.

### Task 4 — Apply `.num` (tabular-nums) to every numeric cell (closes H3)
- **Files touched:** `KpiTicker.tsx`, `TickerStrip.tsx`, `MarketIntelligencePanel.tsx`, `FooterBar.tsx`, `DealRoomPanel.tsx`, `InventoryOverviewPanel.tsx`, `WebsiteOverviewPanel.tsx`, `ClockCalendar.tsx`, `UnitConverterPanel.tsx`, `ProviderStatusPanel.tsx`, `TodaysBidsPanel.tsx`, `InventoryBidsTab.tsx`, `DealBidsTab.tsx`.
- **Maps:** every `font-mono` numeric cell → `num` (or keep `font-mono` and append `tabular-nums`).
- **Tests:** None new. (No test asserts on numeric font.)
- **Acceptance:** With a live tick (or simulated tick in dev), no column edge shifts on price update.

### Task 5 — Install lucide-react; replace top-priority unicode icons (closes H5)
- **Files touched:** `package.json`, `TopBar.tsx`, `KpiTicker.tsx`, `MarketIntelligencePanel.tsx`, `WebsiteOverviewPanel.tsx`, `DealRoomPanel.tsx` (chevron + 🔴), `SortablePanel.tsx`, `Nav.tsx` (Verified pill), `CustomizeButton.tsx`. Defer non-grid icons (the rare 📄 / 💬) to slice 13b unless cheap.
- **Adds:** `lucide-react` dependency. Icon imports per component.
- **Tests:** Update tests that match the menu button by emoji `☰` to use `aria-label`. (Spot-check: most already use `aria-label`.)
- **Acceptance:** No unicode arrow/icon glyphs render in the grid chrome or KPI rows. Bell/Mail/Search/Menu/Chevrons/Grip render as monochrome SVG.

### Task 6 — Sticky LayoutEditBar + global focus-visible ring (closes H6, H8)
- **Files touched:** `LayoutEditBar.tsx` (or `DashboardGrid.tsx`), `globals.css`.
- **Adds:** `sticky top-0 z-10 backdrop-blur bg-surface/80` to the edit bar; global `:focus-visible` outline using `hsl(var(--gold) / 0.7)` with `outline-offset: 2px`.
- **Tests:** Manual focus-tab walkthrough of the dashboard. Existing a11y tests should not regress.
- **Acceptance:** Tabbing through the page shows a gold ring on every interactive control; the edit bar stays visible while scrolling in edit mode.

### Task 7 — Standardize tab strip + status pill chrome (closes M2, M8)
- **Files touched:** `globals.css` (utility def), `MarketIntelligencePanel.tsx`, `PriceTrendPanel.tsx`, `UnitConverterPanel.tsx`, `DealThreadAccordion.tsx`, `DealRoomPanel.tsx` (vis badge), `TradeNetInventoryList.tsx` (sold + vis badge), `InventoryBidsTab.tsx` (status pill), `DealBidsTab.tsx` (status pill).
- **Adds:** `.tab` / `.tab-active` and `.pill` / `.pill-{gold,pending,accepted,neutral}` utilities.
- **Tests:** Sweep test files for literal-class assertions on tab/pill chrome; replace with text/role/aria queries where needed.
- **Acceptance:** Tabs everywhere render with an underline-on-active indicator (animated optional). All status pills share padding, type, and shape.

### Task 8 — Polish the `Panel.unwired` placeholder + add hairline footer + `surface-card` hover restraint (closes H10, M9, M13)
- **Files touched:** `Panel.tsx`, `FooterBar.tsx`, `globals.css`.
- **Adds:** In `Panel.tsx`, an `unwired` state with a faint dashed wireframe block (lucide `Construction` or `Sparkles` icon, h-4 w-4 text-text/15, above the existing text). In `FooterBar.tsx`, `border-t border-border`. In `globals.css`, `.surface-card.featured:hover { border-color: hsl(var(--border)); }` (or apply via Tailwind className on the featured KPI card directly to avoid CSS specificity).
- **Tests:** Snapshot of `BusinessPlaceholder` may capture text content; verify the wireframe block isn't picked up as content text in unwired test assertions.
- **Acceptance:** Empty placeholders read as "intentionally pending" wireframes. Footer has a visible top edge. Featured Gold KPI card no longer double-rings on hover.

### Slice 13 — total estimated effort
- ~8 tasks
- ~280–360 LoC net change across ~18 files (mostly mechanical token sweeps)
- 1 new dependency (`lucide-react`)
- ~4–6 test files need class-assertion sweeps (low touch each)
- **No new business logic. No data layer touches.** Pure presentational.
- Estimated time: 1 focused day for an LLM-paced execution, 1–2 days for verification + AMOLED screenshot pass.

---

## §5 What to defer

### Defer to Slice 13b (next polish pass)

These are coherent but not load-bearing for the brand feel:

- **M1** — Nav inactive section affordance (lock icon / dimmed style)
- **M3** — Sparkline w/h props + larger size in Website panel
- **M4** — Drag preview lift / shadow on isDragging
- **M5** — Settings panel checkbox/select chrome
- **M6** — Unit Converter input chrome (`.input-chrome` utility)
- **M7** — TopBar profile chip chevron affordance
- **M10** — Demo banner integration into TopBar
- **M11** — KPI diamond placeholder dashed border specificity fix
- **M12** — PriceTrend legend + tooltip styling
- **M14** — Inventory tile count typography bump
- **M15** — Extract shared `<MetricTile>` component

### Defer to Slice 13c (or polish backlog)

Pixel-level fidelity nits — collect for a later pass:

- **L1** — FreshnessDot aria-label
- **L2** — Time-based greeting
- **L3** — Calendar day hover state
- **L4** — Deal Room price right-column alignment
- **L5** — Deal Room "View all" brighter baseline
- **L6** — Edit-mode toolbar overlap prevention
- **L7** — AiyaLogo facet stroke token
- **L8** — KPI ticker breakpoint refinement
- **L9** — TradeNet quantity copy ("Qty N")
- **L10** — Demo banner AMOLED contrast
- **L11** — Panel loading skeleton
- **L12** — Panel empty illustration
- **L13** — CustomizeButton lucide swap (folds into H5 sweep if cheap)
- **L14** — Drag handle pulse-on-enter affordance
- **L15** — Verified Member icon

### Decision-gated items (do NOT do without user confirmation)

- **H7** — RightRail rebalance. Moving `ProviderStatusPanel` + `TodaysBidsPanel` out of the grid into the right rail changes the customization story (those panels can no longer be drag-reordered). User should choose between (a) keep them grid-resident + bulk up the right rail with something else, or (b) accept the reduced customization footprint.

---

## §6 Risks

### 6.1 Test-suite breakage

- **Snapshot tests:** I did not exhaustively read every `test/components/*` file. Tasks 2, 5, 7 in the cut all touch class strings; a class-snapshot test (`expect(el).toMatchSnapshot()` capturing className) would break en masse. Before starting Slice 13, run `grep -rE "toHaveClass\(|className.*toMatch" test/` to find the actual breakage surface.
- **Accessibility tests:** Several panels have `aria-label` queries in tests (verified by spot-check on `DealRoomPanel`, `TodaysBidsPanel`). Task 3's `Panel` wrap MUST preserve the data-testids on the bespoke `TodaysBidsPanel` and `ProviderStatusPanel` (`testid="panel-provider-status"`). If lost in the refactor, related dashboard tests break.
- **Render-count test:** The spec mandates "a single-symbol tick must not re-render unrelated panels." Adding new `lucide-react` icons inside `LiveCard` (KpiTicker.tsx:42) MUST not pull in a non-memoized render path. Lucide icons are stateless functional components, so this is safe, but verify with the existing render-count test if it exists.

### 6.2 Performance regressions to watch

- **lucide-react bundle size:** Tree-shaken individual imports (`import { Bell } from "lucide-react"`) are ~200B each. Total slice-13 icon import bill: ~2–4KB. Acceptable. **Do NOT** import via wildcard.
- **Box-shadow stacking on drag:** Task M4 (deferred) adds a layered shadow during drag — fine because it's on a single dragging element. If extended to hover-everywhere, expect a paint-time hit. Keep shadow on drag only.
- **Sticky LayoutEditBar:** Task 6 adds `backdrop-blur` which forces compositing on the sticky element. On low-end devices this is a 1–2ms cost per frame while scrolling. Acceptable.
- **Tabular-nums:** No perf cost. Pure font-variant.
- **Focus-visible global outline:** No perf cost.

### 6.3 Brand drift risk

- **Lucide icons can flatten the brand:** Lucide is a generic-utility icon set. The Cormorant serif + foil-text wordmark are the AIYA brand carriers; icons should remain pure-monochrome and small (`h-3 w-3` / `h-3.5 w-3.5` for chrome, `h-4 w-4` for affordances) so they read as "utility" not "voice". The crown glyph `♛` should stay — it's brand language, not chrome.
- **Pill standardization risk:** Reducing 5 pill variants to 4 may flatten meaningful affordance differences. Specifically: the gold "Shared via [Circle]" badge currently reads as "you have access" — it's a permission cue, not a status. Keep `pill-gold` as the visibility variant; keep `pill-pending`/`pill-accepted` for bid/order status; do not collapse the visibility-circle badge into the same family or the meaning flattens.
- **Type-scale rigidity risk:** Establishing `.t-eyebrow` etc. forces every label to one of 4 roles. If a future panel needs a slightly different size (e.g. compact density mode), it must fork. Accept this — the entire point is forcing the system. Honor density mode by using CSS variables in the utilities: `.t-eyebrow { font-size: var(--text-eyebrow, 10px); }` and have `[data-density="compact"]` override.
- **Focus ring color:** Gold ring on every interactive element is a strong brand statement but it competes with the gold accent on Gold-themed KPI cards. If users find it noisy, fall back to `outline-color: hsl(var(--text) / 0.4)` for a neutral ring.

### 6.4 What this audit explicitly does NOT cover

- Mockups 2 (Elite Command Center), 3 (Website Overview), 4 (Deal Room) — out of scope.
- Mobile drawer (`mobile-iphone.jpeg` exists in root but no audit of the drawer's polish vs the dashboard polish).
- Admin pages (`/inventory`, `/diamonds`, `/website`, `/deals`, `/circles`, `/exchange`) — these have their own panels (e.g. `InventoryAdmin.tsx`, `TradeNetInventoryList.tsx`) which the polish pass should EVENTUALLY visit, but Slice 13 should focus on `/` first to make the win immediately visible.
- Lighthouse scoring and CLS — those have their own slice (14, web-vitals). Polish changes (lucide imports, sticky edit bar) should not regress those metrics; verify in slice-13 verification step.

---

## Appendix A — Quick metric summary (for ticket sizing)

| Metric | Count |
|---|---|
| Panels rendered on `/` | 17 |
| Panels using `Panel` primitive | 15 |
| Panels using bespoke chrome | 2 (TodaysBidsPanel, ProviderStatusPanel) |
| Off-palette tone instances (zinc/amber/rose/emerald) | 67 |
| Files with off-palette tones | 7 |
| `font-mono` callsites without `tabular-nums` | 27 |
| `shadow-*` Tailwind utility uses in components | 0 |
| `focus-visible:` ring uses | 0 |
| `transition-*` uses in components | 4 |
| Icon-library imports (lucide-react etc.) | 0 |
| Unicode glyph icons | ~14 distinct |
| Tab strips (no active-indicator underline) | 4 |
| Status pill variants in use | 5 |
| 🔴 findings | 10 |
| 🟡 findings | 15 |
| 🟢 findings | 15 |
| Slice-13 cut task count | 8 |
| Slice-13 estimated LoC delta | 280–360 |
| Slice-13 new dependencies | 1 (`lucide-react`) |
