# Slice 26 — WinJewel CSV Customer Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Stateless upload → preview → commit CSV import writing customers via the slice-22 `(org_id, external_ref)` idempotency key. Zero new deps, zero migrations, zero API keys needed.

**Spec (authoritative contracts — read the cited §§ before coding):** `docs/superpowers/specs/2026-07-17-winjewel-csv-import-slice-26-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-26-winjewel-import`

**House rules:** exit codes via log-file + `echo "EXIT=$?"` (piping to tail eats them); node_modules installed — no reinstalls; TDD failing-first per task; NO detached full-suite runs (controller owns it); shared-db harness (`test/helpers/shared-db.ts`) for action tests; demo RSC harness per `test/app/customer-edit-activity.test.tsx`; zod v4: `z.email()` not `z.string().email()`.

**Reference patterns:**
- `src/lib/customers/actions.ts` — the `run()` scaffold to copy (import `safeErrShape`/`mapDbConstraintError` from `@/lib/actionErrors` — post-hotfix location)
- `src/lib/watchlists/actions.ts` — freshest example of the same scaffold + `onConflictDoUpdate`
- `src/lib/activity/types.ts` — verb whitelist to extend (`"imported"` in a `// import` group or appended to lifecycle)
- `src/components/watchlists/WatchToggle.tsx` — client-component action-call conventions
- `test/db/activityEvents.test.ts` + `test/lib/customers/actions.test.ts` — shared-db test shapes

---

## Task 26-1 — RFC-4180 parser

**Files:** Create `src/lib/csv/parse.ts`, `test/lib/csv/parse.test.ts`.

Contract: spec §3 EXACTLY (headers + rows split; pad/truncate ragged rows to header length; BOM strip; CRLF+LF; quoted fields with `""` escapes and embedded commas/newlines; skip fully-empty trailing lines; throw with 1-based line number ONLY on unterminated quoted field; empty input → `{ headers: [], rows: [] }`; header-only → rows `[]`).

TDD: write the ~15-case truth table FIRST (cases enumerated in spec §7 bullet 1 — include at minimum: simple 2×2; quoted comma; escaped quote (`"a""b"`); quoted embedded newline; CRLF file; BOM+content; ragged short row padded; ragged long row truncated; trailing empty lines skipped; interior empty line → row of empties (padded); unterminated quote throws with line number; empty string; header-only; whitespace preservation inside quotes; no trimming of unquoted fields beyond the spec). Implementation is a single character-walk state machine (~60 lines) — resist regex.

Verify: scoped test + tsc, both with EXIT lines. Commit `feat(csv): RFC-4180 parser (slice 26-1)`.

## Task 26-2 — WinJewel preset + fixture + verb

**Files:** Create `src/lib/customers/import/winjewelPreset.ts`, `test/lib/customers/import/winjewelPreset.test.ts`, `test/fixtures/winjewel-customers.csv`; modify `src/lib/activity/types.ts` (append `"imported"` verb — keep group comments).

Contract: spec §4 EXACTLY — `matchHeaders` (case/space-insensitive aliases, `{ ok: false, missing: [...] }` naming the REQUIRED fields that couldn't be matched: externalRef + name are the only required ones), `mapRow` (required-field checks, email via `z.email()` safeParse, caps name/businessName ≤200, date parsing MM/DD/YYYY | M/D/YY (2-digit pivot: <30 → 20xx else 19xx) | YYYY-MM-DD with unparseable → error, address assembly → slice-22 `CustomerAddress` shape with all-empty → undefined). Export the alias table as a typed const so tests can iterate it.

Fixture (~12 rows, spec §7 bullet 4): happy rows incl. one with quoted comma in the company name, one bad email, one bad date, one duplicate external_ref, one missing name, one with only required fields. Make the fixture's header row use MIXED alias forms (e.g. `Cust#`, `E-mail`, `Customer Since`) to prove alias matching against realistic headers.

Tests: alias matrix (iterate the exported table); missing-header naming; row truth table driven BY THE FIXTURE (parse it with the 26-1 parser — integration seam) plus targeted unit rows; 2-digit-year pivot both sides (e.g. `1/5/29` → 2029, `1/5/31` → 1931); whitelist safety (grep check no test asserts verb-tuple length — pattern established in 25-2, re-verify).

Verify + commit `feat(customers): WinJewel import preset + fixture (slice 26-2)`.

## Task 26-3 — preview/commit actions

**Files:** Create `src/lib/customers/import/actions.ts`, `test/lib/customers/import/actions.test.ts`.

Contract: spec §5 EXACTLY. Key implementation notes:
- Copy the `run()` scaffold from customers/actions (demo guard FIRST, Unauthorized, Zod firstError, ForbiddenError map, safeErrShape/Sentry fallback, `revalidatePath("/customers")` on success). `__setTestDb` seam included.
- Shared pipeline helper (module-local): `parseAndMap(csvText)` → `{ headerError? , rows: ImportRowResult[], valid: ImportCustomer[] }` used by both actions; also dedupe-within-file (last wins) producing `skippedInFile` + flagged sample entries.
- Membership SELECT: `inArray(customers.externalRef, refs)` scoped `eq(customers.orgId, orgId)` — chunk the IN list at 500 to bound statement size.
- Commit UPSERT: drizzle `insert(customers).values(chunk).onConflictDoUpdate({ target: [customers.orgId, customers.externalRef], set: { name: sql`excluded.name`, ... , updatedAt: new Date() } })` — NOTE the partial unique index (`WHERE external_ref IS NOT NULL`): drizzle's `onConflictDoUpdate` supports `targetWhere` for partial indexes — check the installed drizzle version's API (`node_modules/drizzle-orm`) and use `targetWhere: isNotNull(customers.externalRef)` if required by PG to match the partial index (PG requires the conflict target to match the index predicate — it DOES need the WHERE clause). If drizzle's typing fights, fall back to a raw `sql` INSERT ... ON CONFLICT with the predicate — correctness over ORM purity; test proves it either way.
- Excluded-column set: name, business_name, email, phone, address, first_seen_at, updated_at. NOT created_at, NOT org_id.
- Audit: ONE `recordActivitySafely` — entityType `"org"`, entityId orgId, verb `"imported"`, counts-only payload (spec §5). AFTER the upserts succeed.
- Caps: csvText ≤ 5MB (Zod), rows ≤ 5000 post-parse (error, not truncate).

Tests (shared-db; fixture-driven where natural): preview counts + create/update split (pre-seed one matching customer → wouldUpdate 1); in-file duplicate → last-wins + skipped count; commit → rows land with externalRef/firstSeenAt set; **idempotency proof**: commit fixture twice → second run `{ created: 0, updated: N }`, row count unchanged; cross-org: pre-seed org-2 customer with SAME external_ref → untouched by org-1 commit (both its name and count); caps (oversize text → error without parse; 5001 rows → error); demo block; audit event exists once with correct counts, payload has NO name/email strings; ForbiddenError-free happy path returns counts.

Also extend `test/lib/customers/actions.test.ts`? NO — instead add one regression assertion IN THIS FILE: the manual `createCustomer` action (import it) still produces rows with `externalRef: null` (the slice-22 closure holds).

Verify + commit `feat(customers): previewImport/commitImport actions (slice 26-3)`.

## Task 26-4 — wizard UI + page + link

**Files:** Create `src/components/customers/import/ImportWizard.tsx`, `test/components/customers/import/ImportWizard.test.tsx`, `src/app/(admin)/customers/import/page.tsx`, `test/app/customers-import-page.test.tsx`; modify `src/app/(admin)/customers/page.tsx` (add "Import CSV" link next to "New customer") + its test if one asserts the header links.

- Wizard (client): state machine idle → previewing → previewed → committing → done | error. File input `accept=".csv,text/csv"`, client-side size check (5MB → inline error, no action call), `file.text()` → `previewImport({ csvText })`. Preview card: counts row (total/valid/invalid/create/update), first-20 table (rowIndex, name, externalRef, errors in rose), Commit button disabled when validCount === 0, Cancel resets. Commit → result banner (`Imported N (X new, Y updated, Z skipped)`) + "Back to customers" link. Mirror WatchToggle's useTransition + role="alert" + router.refresh conventions.
- Page: RSC, force-dynamic, customers-page header conventions ("Import customers" title, back link), renders the wizard. Demo mode: wizard still renders; actions return the demo error — surface it via the standard alert path (no special-casing).
- Tests: wizard states with mocked actions module (file input via a File object + fireEvent change; jsdom `File.prototype.text` exists — if flaky, refactor wizard to accept an injected `readFile` prop defaulting to `(f) => f.text()` and inject in tests — implementer's judgment, note the choice); page demo-harness render (title + wizard present); customers-page link assertion.

Verify (scoped: new tests + `test/components/customers/` + tsc) + commit `feat(customers): import wizard UI + /customers/import (slice 26-4)`.

---

## Final verification (controller)

Full suite detached → expect ~1313 baseline + ~55 ≈ 1370, VITEST_EXIT=0. tsc → 0. Final review probing: parser edge-correctness vs spec, upsert partial-index conflict-target correctness, cross-org isolation, PII in audit/Sentry, idempotency proof quality, wizard state machine. Merge `--no-ff` → push → ROADMAP `shipped:` + HANDOFF.

## Done condition

- 4 commits + docs; no migration; no new deps
- Fixture imports cleanly twice (idempotent) in tests; manual form still can't write external_ref
- /customers/import works in the desktop build context (server actions — nothing special needed)
- Full suite green; tsc clean; ROADMAP row 26 shipped
