# iDesign Command Center — Product Roadmap

**Last updated:** 2026-06-07
**Owner:** Clayton (across both tabs)
**Source of truth:** This document. Both tabs read it before claiming a slice.

---

## 1. Vision (in one paragraph)

**iDesign Command Center is a single-pane-of-glass operating system for SMB CEOs and operators.** The product is a generic *shell* — live market data, customizable layout, multi-tenant orgs, observability, mobile-first — and *pluggable vertical modules* that adapt the experience for a specific industry. The first module is **AIYA Designs** (jewelry trade), built end-to-end for a real customer migrating off WinJewel. Every future vertical (CPG, restaurants, hospitality, services) reuses the same shell and plugs in its own categories, workflows, integrations.

The bet: every SMB CEO wants the same primitives (revenue, market, team, customers, deals, payments, audit, alerts) but *expressed in the language of their industry*. The shell + module architecture lets one codebase serve every vertical without becoming a generic SaaS that nobody loves.

## 2. Operating principles

1. **Shell stays vertical-agnostic.** If a feature only makes sense for one industry, it goes in a module.
2. **Modules are additive, not invasive.** A module can extend the shell (new panels, new routes, new menu items) but never edits shell internals.
3. **Tenant chooses module.** Every `orgs` row has a `module: "core" | "aiya-jewelry" | <future>` field. UI loads conditional pieces from the active module registry.
4. **Demo mode is canonical.** Every feature ships with demo seed data. If demo mode is broken, the feature isn't done.
5. **Plain text in, plain text out.** Never construct HTML from user data. Never trust client-supplied MIME or `Content-Type`. Validate at the boundary (Zod) and escape at render (React's defaults).
6. **Multi-tenant invariant is law.** Every read takes explicit `orgId`. Every write defends-in-depth via `eq(orgId, callerOrgId)` in the WHERE clause. No defaults, no implicit tenants.
7. **AI is a layer, not a feature.** Anything we can express as "ask the command center" should eventually flow through the AI command layer (slice 23+ groundwork).
8. **Quality over speed, always.** TDD discipline. Two-stage review (spec compliance + code quality) before merge. No `// eslint-disable` without a paired comment.
9. **Worktree-isolated execution.** Each slice runs in `.worktrees/slice-N`. Main is a coordination space, not an editing space. See `docs/worktrees.md`.
10. **Coordinate via this file.** Before either tab starts a slice, edit §9 below to claim it. Numbering collisions stop here.

## 3. The shell — what is "core"

Core is everything that applies to **any** SMB CEO, regardless of industry. It is the platform. Authoring choices that constrain to one vertical are not allowed in core.

### 3.1 Shipped core (today)

- **Auth + multi-tenant orgs** (slice 3). JWT via `jose`, `requireSession`, `getCurrentOrgId`, RSC pages thread `orgId` everywhere.
- **Layout system** (slice 11 + slice 1c). `PANEL_REGISTRY` + `PanelCtx`, customizable grid, hide/show/resize, persisted per user.
- **Mobile drawer + responsive shell** (slice 2 + slice 20). `Shell.tsx`, hamburger nav, mobile-first design tokens.
- **Live market data** (slice 1). Finnhub + Twelve Data + CoinGecko + Frankfurter + gold-api.com providers, router with fallbacks, FAST/SLOW cache lanes, simulated provider for build + demo.
- **KPI panels** — Revenue/Profit/Clients/Employees/Projection. Slice-2 manual entry now; AI-assisted entry in a future slice.
- **Observability** (slice 11 + 12 + 14). Sentry with PII scrubbing, action-wrapper auto-tagging, Web Vitals → Sentry, Lighthouse CI gates on PRs.
- **Demo mode** (slice 1 demo). `NEXT_PUBLIC_DEMO_MODE=true` short-circuits every query layer and substitutes authored seed data.
- **Multi-tenant Circles** (slice 4). Cross-org private content sharing primitive. Used today for Deal Room visibility; useful for any vertical's partner-sharing feature.
- **Deal Room mechanic** (slice 2 + 10 + 16). Post BUY/SELL, optional circle visibility, reply threads (private/group), bidding with accept/reject/auto_reject lifecycle. Generic mechanic; categories are configurable per module.
- **Attachments + signed-URL storage** (slice 17). Netlify Blobs private store, magic-byte MIME validation, owner-only upload/delete, per-deal caps. Generic; any vertical can use it.
- **CSP + HTTP security headers** (slice 11). DSN-narrow CSP, hardened middleware.

### 3.2 Core in flight or queued

- **Customers** (slice 22 — in progress, this tab). Generic customer roster. Every vertical has customers.
- **Activity feed / audit log** (slice 24 — queued). Append-only per-org event log. Every vertical needs this for compliance + history.
- **Watchlists + email alerts** (slice 25 — queued). Saved searches + Resend email infra. The infra (Resend) is reused by every module that needs to send mail.
- **AI image-to-listing** (slice 23 — queued). Generic image → structured listing prefill (works for jewelry, art, vintage, anything photogenic).
- **Document vault** (slice 31 proposed). Contracts, NDAs, signed agreements. Same Blob primitive as slice 17, different UX.

### 3.3 Novel / industry-first features (planned)

These are bets — most don't exist in competing products. Many are AI-enabled now that wouldn't have been feasible 2 years ago.

1. **AI Command Layer** — Natural-language interface across the whole product. "Show me deals stuck in negotiation > 7 days." "What's my gross margin trend on Diamonds this quarter?" "Schedule a follow-up with Mehta Diamonds for Tuesday." Dispatches to the relevant module, returns inline results, optionally executes actions with confirmation. The AI sees the user's role + tenant + permissions; it can't escape those. (Slice 35+.)

2. **Replayable Decisions** — When the user makes a strategic decision (accept this bid, hire this person, raise prices 5%), the system snapshots the entire context (market state, inventory levels, customer pipeline). Later they can ask "what if I'd done X instead" and the system reconstructs and forks the timeline. Treats business decisions as branched timelines. Useful for retrospective learning + investor questions. (Slice 40+.)

3. **Anomaly Sentinel** — Always-on background analyzer watching every KPI stream. Detects unusual patterns (revenue dip, slow inventory turnover, customer cooling) and surfaces them with diagnosis: "Mehta Diamonds is cooling — 38 days since last bid vs 11-day average. Likely cause: missed their Diwali outreach window." Configurable thresholds per metric per tenant. (Slice 38.)

4. **Negotiation Coach AI** — Live during a bid/reply thread negotiation. "Your last 4 closes with this partner averaged +$200/ct over their first bid. Counter at $12,500." Real-time tactical advice in the deal sidebar. (Slice 42, post-AI-Command-Layer.)

5. **Customer Health Score with Behavioral Decay** — Beyond LTV. Combines recency of interaction, sentiment from message threads (LLM-summarized), payment punctuality, bid frequency vs prior baseline, response time. One number on the customer card + drill-down. (Slice 36.)

6. **AI Email/Phone Drafting with Personality Memory** — Per-customer style memory. Knows Mehta prefers concise Hindi-English mix; Saint-Cloud prefers formal French. Drafts outreach in the right register. Voice-to-text on the phone tab for hands-free during showroom visits. (Slice 37.)

7. **Predictive Reorder via Market Triggers** — Watches market prices + historical sell-through + lead times. Surfaces "Order 200g 18k gold now — spot has dropped 4% and your 30-day burn rate is rising." For non-jewelry modules: "Order 50 cases of Pinot — your supplier just lowered futures." (Slice 39.)

8. **Predictive Cash Runway** — Live cash position + forecast inflows from open deals + scheduled payments + recurring costs. "You'll hit minimum cash in 47 days if you don't close at least 2 of these pending bids." Updates every 60s. (Slice 33.)

9. **Investor Update Auto-Generator** — On-demand "send me a 1-page investor update PDF for Q3" — pulls KPIs, generates LLM narrative, formats, exports. Reuses the slice 28 PDF infrastructure. (Slice 41.)

10. **Multi-Modal Search** — Drop a photo into the search bar. "Find similar inventory items." "What did we sell something like this for in the last 12 months?" Uses CLIP-style embeddings stored in Pinecone (the MCP is already connected — we just haven't used it yet). (Slice 44.)

11. **Live Translation in Threads** — Real-time translation in reply threads and bid notes. AIYA-India and Saint-Cloud-France talk in native language; everyone reads in their preferred language. (Slice 46.)

12. **Provenance / Compliance Ledger** — Immutable append-only audit of high-value asset history. For jewelry: Kimberley Process documentation, certified-natural vs lab-grown lineage. For wine: storage temperature history. Same primitive applies anywhere regulators care about chain-of-custody. (Slice 48.)

13. **Generative Display Designer** — For retail-facing tenants: AI generates display arrangements, lighting setups, social-media content from inventory photos. Drop 5 pieces in → get 10 social post variants. (Slice 50.)

14. **Voice-Authenticated High-Value Actions** — Bids above a threshold ($50k? configurable) require a voice match for the action to commit. "Confirm: accept Mehta's bid at $52,300 — say 'I confirm' clearly." (Slice 49, optional polish.)

15. **Smart Escrow Layer** — For high-value cross-circle trades, optional in-platform escrow with wire instructions managed inside the dashboard. Reduces trust friction in B2B. Wire integration via Stripe Connect or similar. (Slice 47.)

16. **Sustainability Scoring** — Per-inventory-item climate/sustainability score (recycled metal %, conflict-free certification, carbon offset). Surfaces in customer-facing PDFs + on listings. (Slice 51.)

17. **Mission Control Voice Interface** — Voice control for hands-free use on a showroom floor or workshop bench. Apple Vision Pro / Meta Quest companion app (later). Web Speech API for browser first. (Slice 53.)

18. **AR Showroom** — Customers view jewelry pieces in AR before in-person meeting. Inventory photo → 3D model (via AI gen) → shareable AR link. Reduces inventory pulls + drives appointment commitments. (Slice 55.)

19. **Team Performance Coaching** — Per-employee dashboard: productivity, deal close rate, response time, customer satisfaction. AI coach suggests one improvement per week ("Maria's response time to inquiries has slowed; consider blocking 30 min before lunch for outreach"). (Slice 43.)

20. **Tenant Module Marketplace** — Third parties build modules for their vertical (CPG, restaurants, services) and tenants subscribe. "App Store for command-center modules." Long-game (Slice 60+) but the architecture decisions today should keep this possible.

### 3.4 Core enablers — small features the above depend on

- **AI Gateway integration** (slice 32) — Vercel AI Gateway provider strings. Used by slices 23, 35, 36, 37, 41, 42, 46.
- **Pinecone vector store** (slice 34) — Already-connected MCP. Provides embedding search for slices 44, 46, 50.
- **Resend transactional email** (slice 25) — Used by 25, 28, 33 (digest), 38 (anomaly alerts), 41 (investor PDFs).
- **Sentry transactions/spans** (extends slice 11) — Already in. Used for the AI command-latency dashboard.
- **WebSocket / streaming layer** (slice 52, future) — Real-time push to mobile + AR companion. May use Vercel Queues (public beta, per session context).

## 4. The first module: AIYA Designs (jewelry trade)

AIYA is the **anchor tenant**. Built end-to-end for the real customer migrating off WinJewel. Every jewelry-specific UI choice + workflow + integration lives in the `aiya-jewelry` module.

### 4.1 Shipped (today)

- **Inventory** with jewelry categories (rings, necklaces, earrings, bracelets, pendants, chains, watch bands, diamonds, gems) — slice 1b-1
- **Diamond price matrix** — natural/lab × shape × carat-band × color × clarity grid with CSV import — slice 1b-3
- **Deal Room categories** — Diamond / Gem / Metal / Finished / Other — slice 2
- **Demo seed orgs** — AIYA Designs (id 1), Mehta Diamonds, Saint-Cloud Atelier, Marathi (slice 4)
- **TradeNet Exchange** — cross-circle inventory sharing — slice 15
- **Inventory Bidding** — partial-fill, quantity-aware accept, sibling sweep — slice 18a/b/c

### 4.2 Queued for AIYA module

- **WinJewel CSV import wizard** — slice 26
- **Jewelry-specific invoice templates** — slice 27/28 (the *invoice mechanic* is core; the *templates* are AIYA module data)
- **GIA / IGI cert lookup integration** — slice 45 (jewelry-only)
- **Kimberley Process provenance** — slice 48 (jewelry-only, generalizes to other certified industries later)
- **AR jewelry viewer** — slice 55 (jewelry-only first; generalizes)

### 4.3 AIYA module API

The module plugs into the shell via:
- Custom category enums (override `deals.category`, `inventory_items.category`)
- Custom demo seed (org, customers, inventory, deals, attachments)
- Custom right-rail panels (Diamond Index, Spot Metals, etc.)
- Custom routes (`/diamonds` price matrix is AIYA-only)
- Custom sidebar nav entries
- Custom invoice + PDF templates

See `docs/MODULES.md` for the contract details.

## 5. Hypothetical future modules

These don't exist yet but the architecture should make them possible. Listing here forces the shell to stay generic.

### 5.1 `cpg-spirits` (Consumer Packaged Goods — wine/spirits/specialty)
- Categories: SKU, brand, vintage, region, ABV
- Inventory by case + bottle + sub-bottle
- Distributor relationships (replace "Circles" with "Distribution Channels")
- TTB / compliance hooks
- Tasting notes + ratings UI

### 5.2 `restaurant-ops`
- Menu items + cost-of-goods tracking
- Daily/weekly POS data integration (Toast, Square)
- Staff scheduling + tips
- Health-inspection log
- Reservations integration (Resy, OpenTable)

### 5.3 `services-shop` (consultancies, agencies, professional services)
- Projects + timesheets + budgets
- Recurring retainers
- Invoicing (reuses core slice 27)
- Slack / Linear integration

These modules are not in the queue today. They exist in this doc to enforce that the shell never bakes in a jewelry assumption.

## 6. Phasing (12-18 month outlook)

Aspirational; specific slice numbers may shift.

### Phase 1 — Foundation (DONE / in flight)
Slices 0-21 (shell + AIYA basics + multi-tenant + Deal Room + Bidding + Photos). **About 60% complete.**

### Phase 2 — Generic CEO ops (Q3 2026)
Slices 22-25, 31-34. Customers, Activity Feed, Watchlists+Email, Document Vault, AI Gateway, Pinecone, Cash Runway, Vendor Mgmt.

### Phase 3 — WinJewel migration arc (Q3-Q4 2026)
Slices 26-30. AIYA's real-customer transition. CSV import, invoices, PDF, payments, history backfill. Ships AIYA into a paying customer.

### Phase 4 — AI Command Layer (Q4 2026 / Q1 2027)
Slices 35-44. Natural-language interface, customer health, AI drafting, multi-modal search, negotiation coach. The product becomes meaningfully AI-native.

### Phase 5 — Novel / industry-first (2027)
Slices 45-55. Provenance ledger, escrow, live translation, voice authentication, AR showroom. Each is a defensible moat.

### Phase 6 — Marketplace (2027-2028)
Slice 60+. Open module SDK. Third-party verticals. The bet is that by then, AIYA + 1-2 other verticals are proven and the SDK has a real value prop.

## 7. KPIs we'll track (for the platform business itself)

These are NOT customer-facing — they're the iDesign business's own metrics. Eat our own dog food: track them in the command center we built.

- **MAU** per tenant module
- **Latency p99** of dashboard first paint (Web Vitals already wired)
- **AI command success rate** (when AI Command Layer ships)
- **Error rate** (Sentry; alert if > 0.1% of sessions hit an unhandled error)
- **Tenant module adoption** (which modules are active per org)
- **WinJewel migration success rate** (% of customer's data that migrated cleanly)
- **Time-to-first-bid** for new tenants (proxy for activation)

## 8. Open strategic questions

These need answers before the relevant slices kick off. Either tab can propose; the other replies.

- **Q1.** Do we build invoices (slice 27) inside core or AIYA module?
  - Core: every business invoices. Same primitive across verticals.
  - Module: invoice format varies wildly by industry (jewelry vs SaaS vs restaurants).
  - **Recommendation:** Core schema + core mechanic, *templates* in module. Same as we did with categories.

- **Q2.** Do we monetize per-seat, per-tenant, per-module, or all of the above?
  - Per-seat = standard SaaS, simple to bill
  - Per-tenant = friendlier for small businesses but caps revenue
  - Per-module = "you can add CPG vertical for $X/mo" — marketplace future
  - **Recommendation:** TBD. First customer (AIYA) is free / cost-recovery. Pricing model decision deferred to when we have 2+ customers.

- **Q3.** AR/3D viewer (slice 55) — build in-house with Babylon.js (already in plugins) or partner with a 3D scanning service?
  - In-house = control, integration with our auth
  - Partner = faster ship, recurring SaaS cost
  - **Recommendation:** Partner first (faster validate), in-house later if it sticks.

- **Q4.** Voice features — Web Speech API only (browser-native, free) or full Whisper API (better accuracy, costs)?
  - **Recommendation:** Web Speech for browser commands; Whisper for transcription-of-record (phone calls, meetings).

- **Q5.** Module activation — single-tenant-one-module, or can a tenant enable multiple modules?
  - **Recommendation:** Single module per tenant initially. Multi-module is a marketplace-era concern.

## 9. Slice queue + ownership

**Both tabs MUST edit this section before claiming a slice.** Format:

```
| # | Title | Layer | Status | Owner | Notes |
```

### Active

| # | Title | Layer | Status | Owner | Notes |
|---|---|---|---|---|---|
| 22 | Customers + CRM panel | core | shipped: `3866e58` | this-tab | 4 phases. 14 commits + 1 null-safe nav fix. Two-stage review applied; MINORs tracked as #92. |
| 24 | Activity feed panel (audit log) | core | shipped: `09986bf` (Phase A+B) | this-tab | Schema + helpers + tests + customers actions instrumented. 11 commits, +35 tests (1106/1106). Phase C (UI + remaining action files) becomes slice 24b. |
| 24b | Activity feed — remaining action instrumentation (deals/circles/inventory) | core | shipped: `2464acc` | this-tab | 3 tasks. 18 handlers instrumented (5 deals + 6 circles + 7 inventory) + 18 test assertions. `client.test.ts` timeout bump. 1106/1106 green. |
| 24c | Activity feed — UI (ActivityPanel + /activity route + per-customer section) | core | shipped: `ed432b0` | this-tab | 5 commits. Shared ActivityList; panel auto-appears for existing layouts (getEffectiveLayout merge); link-cursor pagination precedent set. +15 tests (1121/1121). Activity feed arc (24/24b/24c) complete. |

### Queued — claim before starting

| # | Title | Layer | Status | Owner | Notes |
|---|---|---|---|---|---|
| 23 | AI image-to-listing (Vercel AI Gateway) | core | queued | open | Stub: generic photo→listing prefill |
| 25 | Watchlists + email alerts (Resend) | core | queued | open | Establishes Resend infra; reused by 28/33/38/41 |
| 26 | WinJewel CSV import wizard (W2) | aiya-jewelry | queued | open | Depends on slice 22 |
| 27 | Invoice schema + create/edit form (W3) | core | queued | open | Mechanic + schema in core; templates in module |
| 28 | Invoice PDF + email send (W4) | core | queued | open | Reuses Resend from 25 |
| 29 | Payments + balance tracking (W5) | core | queued | open | Audit-logged via 24 |
| 30 | WinJewel invoice history import (W6) | aiya-jewelry | queued | open | Depends on 26/27/29 |
| 31 | Document vault (contracts, NDAs) | core | proposed | open | Reuses slice-17 Blob seam |
| 32 | AI Gateway provider integration | core | proposed | open | Foundation for 23/35/36/37/41/42 |
| 33 | Predictive cash runway panel | core | proposed | open | Depends on 27/29 (invoices, payments) |
| 34 | Pinecone vector store integration | core | proposed | open | Foundation for 44/46/50 |
| 35 | AI Command Layer (NL → action) | core | proposed | open | Depends on 32 |
| 36 | Customer health score | core | proposed | open | Depends on 22/24 |
| 37 | AI email drafting + personality memory | core | proposed | open | Depends on 32/22 |
| 38 | Anomaly Sentinel | core | proposed | open | Depends on 24 |
| 39 | Predictive reorder via market triggers | core | proposed | open | Depends on inventory + market |
| 40 | Replayable Decisions (snapshot + branch) | core | proposed | open | Big lift; possibly split |
| 41 | Investor update auto-generator | core | proposed | open | Depends on 28 PDF + 32 AI |
| 42 | Negotiation Coach AI (in-thread) | core | proposed | open | Depends on 32/35/10/16 |
| 43 | Team performance coaching | core | proposed | open | Depends on team / employee data |
| 44 | Multi-modal search (image → match) | core | proposed | open | Depends on 34 Pinecone |
| 45 | GIA/IGI cert lookup integration | aiya-jewelry | proposed | open | Module-specific |
| 46 | Live translation in threads | core | proposed | open | Depends on 32 |
| 47 | Smart escrow layer (Stripe Connect) | core | proposed | open | Big-decision slice |
| 48 | Provenance / compliance ledger | core | proposed | open | Append-only — could land on slice 24 |
| 49 | Voice-authenticated high-value actions | core | proposed | open | Polish; can defer |
| 50 | Generative display designer | core | proposed | open | Depends on 32 AI Gateway |
| 51 | Sustainability scoring | core | proposed | open | Per-vertical scoring rules |
| 52 | WebSocket/streaming layer | core | proposed | open | Real-time push primitive |
| 53 | Voice command (Web Speech API) | core | proposed | open | Mission Control voice interface |
| 55 | AR showroom integration | aiya-jewelry | proposed | open | Partner-first (Q3 question) |
| 60+ | Module SDK + marketplace | core | proposed | open | Long-game; not before 2 verticals proven |

### Cleanup / refactor slices (cross-cutting, not user-facing)

| # | Title | Layer | Status | Owner | Notes |
|---|---|---|---|---|---|
| C-1 | Module skeleton: `orgs.module_id` column + manifest type + empty registry + `getActiveModule()` | core (enforces module boundary) | shipped: ce197d7 | subagent-C-1 | Scope re-purposed from category-enum extraction (that work split to C-4/C-5) to MODULES.md §9 Phase M1 — see commits 79eee56 (schema+migration 0015), 2dbe63c (types+registry+active+getCurrentOrgModuleId), ce197d7 (tests) |
| C-2 | Move `inventoryItems.category` + `deals.category` to FK references | core | proposed | open | Depends on C-1 |
| C-3 | Add `orgs.module: enum` column | core | proposed | open | Lets UI conditionally load AIYA pieces |
| C-4 | Module registry pattern in code (`src/modules/aiya-jewelry/`) | core | proposed | open | Mechanical refactor; see MODULES.md |
| C-5 | Move WinJewel-specific UI strings (e.g. "Diamond Index") behind module config | aiya-jewelry | proposed | open | Brand layer |

## 10. Coordination protocol between the two tabs

The hard rule: **edit §9 before starting a slice.** Specifically:

1. Open `docs/ROADMAP.md` in whichever tab you're on.
2. In §9, find the slice you want. Change `Owner: open` → `Owner: this-tab` AND note your timestamp in the Notes column.
3. Commit + push that change FIRST, before any feature work. (One-line commit: `chore(roadmap): tab-A claims slice 28`.)
4. THEN start the slice work in a worktree.
5. When done, change `Status: queued` → `shipped: <merge-sha>` in §9 and push.

If both tabs claim the same slice simultaneously, the lower-SHA commit wins; the other tab releases.

For collisions on the same files mid-slice: the worktree pattern in `docs/worktrees.md` makes the file-level collision impossible. Schema-level collisions (both tabs adding a `customers` table) are caught by the §9 claim rule above.

### Things either tab CAN do without claiming

- Documentation changes (specs, plans, READMEs)
- Spec brainstorming (writing a spec doesn't claim implementation)
- Reviewing the other tab's PR/merge (highly encouraged)
- Editing this roadmap (with clear commit messages)

### Things either tab MUST claim before doing

- Any slice implementation (Phase A onwards)
- Any cleanup slice (C-1, C-2, etc.)
- Any merge-to-main
- Any production env var changes

## 11. Brand + naming

- **Platform product name:** iDesign Command Center
- **First module / anchor tenant:** AIYA Designs (jewelry trade)
- **Deploy URL (demo):** https://idesign-dash-demo.netlify.app
- **Repo name:** `dash-demo-` (will rename to `idesign-command-center` later; non-blocking)
- **Package name:** `ceo-command-center` (legacy; align with brand at next major refactor)

## 12. Document hierarchy

This roadmap is the strategic top. Subordinate docs:

- `docs/MODULES.md` — architectural contract (how shell + modules technically fit together)
- `docs/CODE_AUDIT.md` — current file-by-file map of what's core vs module
- `docs/worktrees.md` — worktree workflow (collision avoidance)
- `docs/superpowers/specs/*` — per-slice design specs (one per slice)
- `docs/superpowers/plans/*` — per-slice implementation plans (one per slice)
- `docs/deploy.md` — deploy + Sentry walkthrough (parallel agent added)

All four root-level docs (this one, MODULES, CODE_AUDIT, worktrees) MUST be kept in sync as the codebase evolves. If a slice fundamentally changes shell + module boundaries, that slice's design spec MUST include the corresponding edits.
