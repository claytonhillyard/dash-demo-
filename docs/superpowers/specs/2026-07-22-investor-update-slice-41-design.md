# iDesign Command Center — Slice 41: Investor Update Auto-Generator — Design

**Date:** 2026-07-22
**Status:** Approved; implementation plan pending
**Builds on:** slice 28 (PDF primitives), slice 32 (AI seam), slice 33 (runway compute/readers), slices 27/29 (invoices/payments), slice 2 (legacy revenue/profit months), slices 36/38 (health snapshots).

---

## 1. Overview & Goals

One click → a one-page investor-update PDF: KPI grid + AI-written narrative. Works fully keyless: without `AI_GATEWAY_API_KEY` the narrative is a deterministic template built from the same KPIs, and the PDF carries a "SIMULATED NARRATIVE" banner (honesty over polish). Read-only slice — no migration, no DB writes, no audit rows, zero new deps.

**Goals:**
- `src/lib/investor/collect.ts` — KPI snapshot assembler reusing existing readers.
- `src/lib/investor/narrative.ts` — PII-free prompt builder + `generateAiText` call + deterministic simulated fallback template.
- `src/lib/investor/reportPdf.ts` — report model + painter on the slice-28 primitives (WinAnsi sanitize + wrapText EXPORTED from invoices/pdfModel, not duplicated).
- `GET /company/investor-update/pdf` route + a download card on `/company/projections`.
- `AI_FEATURES` += `"investor-update"`.
- ~40 tests.

## 2. Non-goals (named homes)

Email distribution (slice-25 seam later). Scheduling/cron. Historical archive of generated updates (regenerate on demand — slice-28 philosophy). Charts/graphs in the PDF (text + numbers v1). Editable narrative (regenerate instead). Multi-period comparisons beyond the built-in trends.

## 3. KPI collector — `src/lib/investor/collect.ts`

```ts
export type InvestorKpis = {
  periodLabel: string;            // "July 2026" — from injected now, en-US month + year
  orgName: string;
  revenue: { months: Array<{ ym: string; cents: number }>; latestCents: number | null };  // up to 6, most-recent-first (legacy revenue_months)
  profit: { months: Array<{ ym: string; cents: number }>; latestCents: number | null };   // profit_months, same shape
  receivables: { totalCents: number; count: number; overdueCents: number };               // via getReceivablesRows + computeReceivablesAging (overdue = d1_30+d31_60+d61_plus)
  runway: RunwayResult;                                                                    // computeRunway over trailing profits
  invoicing: { issuedCount: number; issuedCents: number; collectedCents: number };        // THIS calendar month (UTC), org-scoped
  customers: { total: number; healthMix: { healthy: number; watch: number; at_risk: number } | null }; // latest snapshot per customer; null when no snapshots
};
export async function collectInvestorKpis(db, orgId: number, now: Date): Promise<InvestorKpis>;
```

- **No customer names, emails, or any per-customer detail** — aggregates only. This is type-level PII prevention: the narrative prompt is built from this object, so what isn't collected can't leak.
- Reuse: `getReceivablesRows`/`computeReceivablesAging`/`computeRunway`/`getTrailingProfitMonths` (slice 33), `resolveOrgLabel`. New org-scoped SQL only for: the month's issued invoices (count + sum by `issue_date` in the UTC month), the month's collected payments (sum by `received_date`), customer total, and the latest-snapshot-per-customer band mix (`DISTINCT ON (customer_id) ORDER BY customer_id, captured_on DESC` or the greatest-n-per-group idiom already used in sentinel — read `src/lib/sentinel/trend.ts` and mirror).
- Legacy `revenue_months`/`profit_months` read as-is (single-tenant — same honesty comment as slice 33; C-6 tracked).
- Demo branch: NONE needed at collector level — every underlying reader already demo-branches; verify by test that demo mode yields a fully-populated InvestorKpis.

## 4. Narrative — `src/lib/investor/narrative.ts`

```ts
export function buildInvestorPrompt(kpis: InvestorKpis): { system: string; prompt: string }; // pure
export function simulatedNarrative(kpis: InvestorKpis): string;                              // pure, deterministic
export async function generateInvestorNarrative(kpis: InvestorKpis):
  Promise<{ ok: true; paragraphs: string[]; simulated: boolean } | { ok: false; error: string }>;
```

- Prompt: system = "You write concise investor updates. Three short paragraphs, plain factual tone, no hype, no bullet lists." Prompt body = a compact serialization of the KPIs (dollars formatted, runway verdict spelled out). **Contains business aggregates only — the no-@ guard test asserts the serialized prompt has no "@" and no customer-name capability.**
- `generateAiText({ feature: "investor-update", tier: "fast", user: \`org:${orgId}\`… })` — wait, kpis carries no orgId; pass orgId as a second arg to `generateInvestorNarrative(kpis, orgId)` for the `user` tag only.
- Result handling: `ok && !simulated` → split the text into paragraphs (blank-line split, trim, drop empties; cap at 5). `ok && simulated` → IGNORE the seam's canned text; use `simulatedNarrative(kpis)` (three deterministic sentences-per-paragraph derived from the numbers) so the offline PDF reads like a real update. `!ok` → friendly error string (map the seam's code like sendInvoice does).
- Never throws; PII rule: prompt/response text NEVER to Sentry (the seam already enforces).

## 5. Report PDF — `src/lib/investor/reportPdf.ts`

**Prereq (small edit in `src/lib/invoices/pdfModel.ts`):** export the existing `toWinAnsiSafe` (currently private) — behavior unchanged, already test-covered; the report model reuses it + `wrapText`.

```ts
export type InvestorReportModel = {
  banner: "SIMULATED NARRATIVE" | null;
  header: { orgName: string; title: string; periodLabel: string };  // title "Investor Update"
  kpiGrid: Array<[label: string, value: string]>;                    // ~8 rows, both cells WinAnsi-safe
  narrative: string[][];                                            // paragraphs → wrapped lines (90)
  footer: string;                                                    // "Generated by iDesign Command Center — YYYY-MM-DD"
};
export function buildInvestorReportModel(kpis, paragraphs: string[], simulated: boolean, now: Date): InvestorReportModel;
export function renderInvestorReportPdf(model): Promise<Uint8Array>;
```

- kpiGrid rows: Revenue (latest month), Profit (latest month), Outstanding receivables (+count), Overdue portion, Runway verdict (one line), Invoices issued this period ($ + count), Collected this period, Customers (+health mix "H/W/R" when present). formatCentsExact everywhere; absent data → "—".
- Painter: Letter, margin 50, Helvetica/Bold via StandardFonts, y-cursor; banner drawn like slice 28's (large light-gray horizontal above header); two-column KPI grid (labels x=50, values right-aligned to x=562 via widthOfTextAtSize); narrative paragraphs with blank-line gaps; page-break helper (long narratives may spill to page 2 — reuse the slice-28 approach); footer bottom of last page.

## 6. Route + UI

- **`GET /company/investor-update/pdf`** — `src/app/(admin)/company/investor-update/pdf/route.ts`, mirroring the invoices PDF route: `getCurrentOrgId()` try/catch → 401; demo allowed; collect → narrative (a `!ok` narrative → 503 JSON `{error}` — NOT a broken PDF); model → render; headers `application/pdf`, `Content-Disposition: attachment; filename="investor-update-<YYYY-MM>.pdf"` (filename is self-generated ASCII — no sanitizer needed, but keep Cache-Control: no-store). No non-handler exports (the slice-28 build lesson).
- **UI**: a card on `/company/projections` (read that page's card conventions): title "Investor update", one line of copy, a plain `<a href="/company/investor-update/pdf">Download PDF</a>` styled like the invoices header actions, plus a muted note: "Narrative is AI-generated" / in demo or keyless the PDF itself carries the banner. Middleware: `/company/:path*` already guarded (slice-2 matcher test asserts /company/* routes) — verify the matcher covers the new subpath and extend the matcher test (+1).
- Live-mode cost note: each download invokes the AI gateway once; the app enforces NO budget/cooldown — the seam only maps the gateway's own 402/429 after the fact, so the real backstop is session auth + the gateway account's credit ceiling (~$0.20/100 requests at the fast tier; review N1). No extra cooldown v1 (investor updates are rare) — documented decision.

## 7. Test plan (~40)

- **Collector (~12, shared-db):** period invoicing math (issued this UTC month counted, last month excluded — seed both; boundary: issue_date on the 1st); collected sum from received_date; org-scoping (org-999 invoices/payments/customers invisible); health mix latest-per-customer (two snapshots for one customer → latest band wins; no snapshots → null); revenue/profit month shapes most-recent-first; demo mode → fully-populated KPIs (assert the demo receivable total 1,194,000 flows through).
- **Narrative (~10):** prompt contains formatted dollars + runway line; **no "@" in system+prompt for any KPI input**; simulatedNarrative deterministic (same input → same output) + mentions the period label + a dollar figure; generateInvestorNarrative: mock generateAiText — real ok → paragraphs split (multi-blank-line input, cap 5); simulated ok → simulatedNarrative used (seam text ignored — assert); each seam error code → friendly message; never throws.
- **Report model/painter (~10):** banner null vs "SIMULATED NARRATIVE"; kpiGrid formatting incl. "—" absences and the health-mix render; narrative wrapped at 90; CJK/emoji in orgName or narrative sanitized (reuse the exported toWinAnsiSafe — assert "?" replacement); footer date from injected now; painter: bytes %PDF- + loadable, 1 page for a normal update, ≥2 for a synthetic 100-line narrative; simulated-banner render doesn't throw.
- **Route (~5):** demo-mode 200 + headers + loadable bytes + filename period; 401 unauthenticated; narrative failure → 503 JSON (mock generateAiText to error in live-ish harness); no-store.
- **UI (+2):** projections page shows the card + link (demo RSC harness — find the existing /company/projections test or create per the established harness); matcher test +1.
- **AI seam ripple:** adding "investor-update" to AI_FEATURES — grep existing ai tests for feature-list assertions and update.

## 8. Decisions

- Regenerate on demand; nothing stored — the PDF is derived, like invoices.
- Simulated narrative is a local deterministic template from real KPIs (not the seam's generic canned text) + a visible banner — honest offline demo.
- Aggregates-only KPI type = structural PII prevention; the no-@ test locks it.
- Narrative failure → 503 JSON, never a half-broken PDF.
- Read-only: no writes, no audit, no cooldown (auth + the gateway credit ceiling bound a rare action's cost — the seam itself enforces no budget).
