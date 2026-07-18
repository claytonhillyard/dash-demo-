# iDesign Command Center — Slice 26: WinJewel CSV Customer Import — Design

**Date:** 2026-07-17
**Status:** Approved (design); implementation plan pending
**Builds on:** slice 22 (customers table — `external_ref` + `first_seen_at` columns and the partial-unique `(org_id, external_ref)` idempotency key were designed FOR this slice; `external_ref` is closed off from the manual form by design and this import is its only writer), slice 24 (audit events), D-2 (installers — this feature works with zero API keys, so the desktop test build can load the real AIYA roster).

**Unlocks:** slices 27–30 (invoices/payments/history reference imported customers), the real-customer migration.

---

## 1. Overview & Goals

A stateless two-action import wizard at `/customers/import`: upload a WinJewel customer-export CSV → server-parsed preview (validity + create/update split, nothing written) → confirmed commit (batch UPSERT on the idempotency key). Re-running the same file is idempotent by construction.

**Module-boundary call:** the ROADMAP tags this `aiya-jewelry`, but module routing (C-2/C-3) doesn't exist yet. v1 ships a **core CSV-import mechanic with a WinJewel column preset**; the preset is a single file (`winjewelPreset.ts`) so the eventual module extraction is one move. Every vertical wants "import customers from CSV" — only the preset is jewelry-software-specific.

**Goals:**
- In-house RFC-4180 CSV parser (`src/lib/csv/parse.ts`) — zero new deps, brutal test suite. (User veto point offered and not taken.)
- WinJewel preset: header aliases → customer fields, tolerant US date parsing for `first_seen_at`, address assembly into the slice-22 JSONB shape.
- `previewImport(csvText)` / `commitImport(csvText)` server actions — slice-22 `run()` conventions (org from session, demo-guarded, Zod boundary).
- Commit = batch UPSERT `onConflictDoUpdate` on `(org_id, external_ref)`; invalid rows skipped and reported; ONE summary audit event.
- `/customers/import` page + wizard client component + "Import CSV" link on `/customers`.
- 5 MB CSV cap (client + server enforced), 5000-row cap.

## 2. Non-goals (named homes)

- **Generic column-mapping UI** (drag headers → fields) — future core slice when a second vertical needs a different preset; the preset seam is the extension point.
- **Invoice/inventory history import** — slice 30 (W6), on this parser + preset pattern.
- **Background/queued processing** — 5000 rows upserts in one action comfortably; queues when a real file proves otherwise.
- **Dedup beyond external_ref** (fuzzy name/email matching) — operational tooling, not v1 import.
- **Rollback/undo of an import** — idempotent re-run + manual edits cover v1; snapshot-based undo is Replayable-Decisions (slice 40) territory.
- **File persistence** — the CSV text lives only in the two action calls; nothing stored server-side.

## 3. CSV parser — `src/lib/csv/parse.ts` (pure, core)

```ts
export type CsvParseResult = { headers: string[]; rows: string[][]; };
export function parseCsv(text: string): CsvParseResult;
```

RFC-4180: comma-separated; fields optionally double-quoted; `""` escapes a quote inside a quoted field; quoted fields may contain commas and newlines; accepts CRLF and LF; strips a leading UTF-8 BOM; skips fully-empty trailing lines; ragged rows are padded with `""` to header length (and over-long rows truncated) — the MAPPER decides validity, the parser never throws on shape. Throws only on structurally broken quoting (unterminated quoted field), with the 1-based line number in the message.

## 4. WinJewel preset — `src/lib/customers/import/winjewelPreset.ts` (pure)

```ts
export type ImportRowResult =
  | { ok: true; value: ImportCustomer }   // ImportCustomer = { externalRef, name, businessName?, email?, phone?, address?, firstSeenAt? }
  | { ok: false; errors: string[] };      // human-readable, field-scoped

export function matchHeaders(headers: string[]): { ok: true; map: HeaderMap } | { ok: false; missing: string[] };
export function mapRow(map: HeaderMap, row: string[], rowIndex: number): ImportRowResult;
```

- **Header aliases (case/space-insensitive):** externalRef ← `Customer ID | CustID | Customer No | Cust#`; name ← `Name | Customer Name | Contact`; businessName ← `Company | Business | Business Name`; email ← `Email | E-mail`; phone ← `Phone | Phone 1 | Telephone`; street1 ← `Address | Address 1 | Street`; street2 ← `Address 2`; city ← `City`; state ← `State | ST`; zip ← `Zip | Zip Code | Postal Code`; country ← `Country`; firstSeenAt ← `Customer Since | Since | First Sale | Created`.
  Data-driven alias table — extending it when the real AIYA export arrives is a one-line-per-alias change. Unknown columns ignored.
- **Required:** externalRef (non-empty after trim) + name (non-empty). Everything else optional.
- **Validation:** email via the slice-25 zod-v4 `z.email()` convention (invalid email = row error, not silently dropped — the operator should fix the source); phone free-text trimmed; caps mirroring slice-22 Zod (name 200, businessName 200, notes n/a here).
- **Date parsing (`firstSeenAt`):** accepts `MM/DD/YYYY`, `M/D/YY` (2-digit years: <30 → 20xx else 19xx), `YYYY-MM-DD`. Unparseable → row-level error (not a silent null — migration data quality matters).
- **Address:** assembled into the slice-22 `CustomerAddress` JSONB shape; all-empty → undefined (never store `{}` — slice-22 rule).

## 5. Actions — `src/lib/customers/import/actions.ts`

Both wrap in the slice-22 `run()` conventions (copy the scaffold; import `safeErrShape`/`mapDbConstraintError` from `@/lib/actionErrors` — post-hotfix location).

```ts
export type ImportPreview = {
  ok: true;
  totalRows: number; validCount: number; invalidCount: number;
  wouldCreate: number; wouldUpdate: number;
  sample: Array<{ rowIndex: number; ok: boolean; name?: string; externalRef?: string; errors?: string[] }>; // first 20
} | { ok: false; error: string };

export async function previewImport(raw: unknown): Promise<ImportPreview>;   // { csvText: string }
export async function commitImport(raw: unknown): Promise<
  { ok: true; created: number; updated: number; skipped: number } | { ok: false; error: string }
>;
```

- Zod boundary: `csvText: z.string().min(1).max(5 * 1024 * 1024)`; row count capped at 5000 after parse (error beyond, not truncation).
- Preview computes the create/update split via ONE `SELECT external_ref FROM customers WHERE org_id = $ AND external_ref IN (...valid refs)` — set membership decides.
- **Duplicate external_ref WITHIN the file:** last row wins, earlier duplicates counted `skipped` and flagged in the preview sample (deterministic, documented).
- Commit: chunked `INSERT ... ON CONFLICT (org_id, external_ref) [partial-unique] DO UPDATE` (chunks of 500), updating name/business/email/phone/address/first_seen_at/updated_at. Created-vs-updated counts from the pre-commit membership SELECT (same query as preview, re-run inside commit — stateless).
- **Audit:** ONE event — `entityType: "org"`, `entityId: orgId`, verb `"imported"` (whitelist append), summary `` `Imported ${n} customers (${created} new, ${updated} updated) from WinJewel CSV` ``, payload counts only. No per-row events (would spam the feed and fire the watcher chokepoint N times). PII: no names/emails in the audit payload or Sentry.
- Revalidates `/customers`.

## 6. UI — `/customers/import`

RSC page (customers-page conventions) hosting an `ImportWizard` client component: file input (accept `.csv`, client-side 5 MB check) → reads text → `previewImport` → preview card (counts + first-20 table with per-row errors highlighted rose) → Commit button (disabled when `validCount === 0`) → `commitImport` → result banner → link back to `/customers`. Demo mode: actions blocked by `run()`'s guard; the page renders with a demo note. "Import CSV" link appears on `/customers` next to "New customer".

## 7. Test plan

- Parser: ~15-case truth table (quoted commas, escaped quotes, quoted newlines, CRLF, BOM, ragged pad/truncate, trailing empties, unterminated-quote throw w/ line number, empty input, header-only).
- Preset: alias matching incl. case/spacing; missing-required-headers naming exactly which; row mapping happy/invalid email/date variants incl. 2-digit-year pivot; address assembly + all-empty → undefined; required-field failures.
- Actions (shared-db): preview counts + split correctness; in-file duplicate handling; commit creates then re-commit same file → all updates, zero dupes (idempotency proof); cross-org isolation (org 2's identical external_refs untouched); 5 MB + 5000-row caps; demo block; ONE audit event with correct counts + verb "imported"; manual-form path still cannot write external_ref (regression guard).
- Fixture: `test/fixtures/winjewel-customers.csv` (~12 rows: happy, quoted commas, bad email, bad date, duplicate ref, missing name) used across preset + action tests.
- UI: wizard component states (idle/previewed/committed/error) with mocked actions; page renders in demo harness.

## 8. Decisions

- Parser never throws on SHAPE (pad/truncate + mapper decides); throws only on broken quoting — data-quality errors belong to the preview, not a parse crash.
- Stateless two-action flow — re-parse on commit beats server-side temp storage (no cleanup, no session affinity, trivial cost).
- Last-duplicate-wins within a file — matches UPSERT semantics of running rows sequentially; deterministic and documented.
- One summary audit event — feed signal, not feed spam; watcher chokepoint fires at most once per import.
- Preset is data-driven aliases — the real AIYA export refines it by editing a table, not logic.
