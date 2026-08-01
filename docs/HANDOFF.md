# Session Handoff — 2026-06-08

**Purpose:** capture the in-flight state of the iDesign Command Center build so the next session (or the other tab) can resume cleanly without re-discovering context.

**Read order:** §1 (you are here) → §2 (next step) → §3 (everything else).

---

## 1. You are here

### 1.1 What was decided this session
- **Strategic pivot landed.** The product is the **iDesign Command Center** — a generic SMB CEO shell — with **AIYA Designs (jewelry trade)** as its first vertical module. Future verticals (CPG, restaurants, services) plug in via the same manifest contract. See `docs/ROADMAP.md`, `docs/MODULES.md`, `docs/CODE_AUDIT.md`.
- **Two tabs == same repo.** Every commit is authored by "Chilly" (Clayton's git handle). Both terminals MUST claim slices via `docs/ROADMAP.md` §9 before starting. Numbering collisions stop there.

### 1.2 What was shipped to `main`
| SHA | What | Layer |
|---|---|---|
| `cb6ed95` | ROADMAP + MODULES + CODE_AUDIT docs (strategic foundation, 965 lines) | docs |
| `743a766` | Merge slice C-1: `orgs.module_id` column (migration `0015_naive_chamber`) + `ModuleManifest` type + empty registry + `getActiveModule()` helper + `getCurrentOrgModuleId()` session helper + 9 tests | core/shell |
| `3866e58` | Merge slice 22: Customers + CRM panel (migration `0016_left_starbolt`, 15 commits, 1071 tests green) | core |
| `ac28fe6` | ROADMAP §9 row 22 marked shipped | docs |
| `09986bf` | Merge slice 24: Activity Feed Phase A+B (migration `0017_crazy_nitro`, 13 commits, 1106 tests green) | core |
| `15d5fee` | ROADMAP §9 row 24 marked shipped + 24b queued | docs |
| `2464acc` | Merge slice 24b: remaining action instrumentation (18 handlers across deals/circles/inventory + timeout bump on client.test.ts, 5 commits, 1106 tests green) | core |
| `ed432b0` | Merge slice 24c: Activity Feed UI (ActivityList + ActivityPanel + /activity route + per-customer section, 5 commits, 1121 tests green) — Activity feed arc complete | core |
| `ec65e76` | Merge slice 32: AI Gateway integration (`src/lib/ai/` seam, ai@6.0.219, 4 commits, 1136 tests green). Simulated fallback until `AI_GATEWAY_API_KEY` lands in Netlify env + `.env.local`. Unblocks the AI slice family (23/35/36/37/41/42/46/50). | core |
| `815fee0` | Merge slice 36: Customer Health Score (deterministic heuristic + AI insight, Health column + edit-page card, 4 commits, 1175 tests green). First novel-feature bet shipped; first consumer of the 22+24+32 foundation stack. | core |
| `df991d0` | Merge slice 25: Watchlists + Resend email seam (migration `0018_heavy_the_anarchist`, 6 commits, 1269 tests green). Alert dispatch rides the slice-24 chokepoint — all 21 instrumented handlers alert watchers for free. Live sends activate when `RESEND_API_KEY` + `EMAIL_FROM` land in Netlify env. Pre-existing middleware matcher gap (/customers, /activity, /watchlists — UX-only) flagged as a follow-up chip. | core |
| `cb68fb6` | Merge slice 38: Anomaly Sentinel (migration `0019_fast_kitty_pryde`, 5 commits, 1312 tests green). Band drops → health_dropped events → watcher emails + feeds, all via existing plumbing. Review caught a real score-feedback loop (Sentinel alerts inflating the score they watch) — fixed with actor IS NOT NULL on the scoring aggregate + invariant test locking feeds-show/scoring-excludes. | core |
| `b0be40a` | HOTFIX: next build broken on main since slice 22 — sync helpers exported from a "use server" module; moved to `src/lib/actionErrors.ts`. Hidden until now because the Netlify deploy freeze meant `next build` never ran (vitest/tsc can't catch it). Surfaced by D-2's standalone gate proof. | core |
| `987af81` | Merge D-2: desktop test installers. mac x64 DMG (260MB, launch-smoked end-to-end), win NSIS exe (210MB), linux AppImage (249MB) in `desktop/dist/` (gitignored, local). electron pinned 35.7.5 (43 hangs on Intel+macOS 13). CI workflow for native/arm64 builds. See `docs/INSTALLERS.md`. | infra |
| `93c07c9` + `4e36ed1` | Middleware matcher backfill (/customers, /activity, /watchlists) + Merge slice 26: WinJewel CSV import (126 tests, 1438 green). /customers/import wizard, idempotent on (org_id, external_ref). The migration arc (W2) has begun — slice 27 (invoices, W3) is next. | core |
| `0be14ae` | Merge slice 27: Invoices W3 (migration `0020_stormy_starfox`, 118 tests, 1556 green). bill_to snapshot frozen at issue; void-not-delete; int4 overflow capped at the Zod boundary. Review also revived the codebase-wide friendly constraint errors (drizzle DrizzleQueryError cause-unwrap in actionErrors — customers/watchlists/import had silently regressed to "Server error"). Slice 28 (PDF + email via the Resend seam) is next in the arc. | core |
| `09d7859` | Merge slice 28: Invoice PDF + email send W4 (migration `0021_puzzling_randall` sent_at/sent_to, ~120 tests, 1625+ green, next build verified). pdf-lib 1.17.1; pure `buildInvoicePdfModel` + painter split; `sendInvoice` issued-only with simulated-no-stamp; org-scoped `GET /invoices/[id]/pdf` (any status, DRAFT/VOID banners); SendInvoicePanel + Download link on edit. Review Criticals fixed pre-merge: non-WinAnsi (CJK/emoji) text crashed pdf-lib → model-level CP-1252 sanitize ('?' replacement, pre-wrap so surrogates never split); route-module helper export broke `next build` (only next build sees `.next/types` — tsc/vitest were blind to it). Also: ByteString-safe PDF filename, int4 id guard on the route, status-guarded sent stamp, audit-summary truncation. Slice 29 (payments, W5) is next in the arc. | core |
| `2d05a3c` | Merge slice 31: Document vault (migration `0024_wakeful_queen_noir`; ONE additive `BlobStore.get` extension, no new deps; ~80 tests, full suite 2303 green, build clean). Org-scoped `documents` table (+ nullable customer_id, SET NULL FK). Upload PDF/image via `uploadDocument` (magic-byte validated by ACTUAL bytes through the reused `detectKindFromBytes` — never the request Content-Type; SVG/HTML/text rejected), org-scoped, blob-set-then-DB with orphan cleanup; `deleteDocument` atomic `DELETE…RETURNING`. Downloads STREAM through `GET /documents/[id]/file` + the new `BlobStore.get(key)` — @netlify/blobs v10 removed signed URLs, so this is the "Phase C" route-handler flow the blob comment anticipated; response is `attachment` + `no-store` (never inline → no XSS). `/documents` vault page + upload form + two-step delete + nav (wired a pre-existing dead placeholder). `document` added to ACTIVITY_ENTITY_TYPES. customerId is schema-ready but the v1 UI is org-level only (no customer picker). Review (verdict merge): fixed F1 pre-merge — size cap aligned to the 10MB serverActions bodySizeLimit with a client pre-check + try/catch so oversized uploads error instead of failing silently. Deliberately greenfield core — did NOT touch the deals/bids domain (the other tab's `aiya-todays-inventory-bids-18c` worktree). | core |
| `867b490` | Merge C-8: Neon transaction driver — the real-deploy unlock (ONE new dep `ws`; 2230 full suite green + tsc + build). `src/db/client.ts` DATABASE_URL branch now uses `drizzle-orm/neon-serverless` (`new Pool({connectionString})`) instead of `neon-http`, which threw on `db.transaction()` — so recordPayment (slice 29) and every slice-35b confirmed write failed closed on any real Postgres deploy; they work now. `ws` supplies the WebSocket constructor on Node 20 (Netlify's pin), guarded so a native WebSocket on Node 22+/edge wins. recordPayment takes a `SELECT…FOR UPDATE` row lock (org-scoped, first statement inside the tx) closing the slice-29 review-F2 overpay race on server Postgres. **Verification is split by necessity:** pglite path (demo/desktop/tests) proven unchanged headlessly; the actual Neon WebSocket connection + transaction CANNOT be exercised without a Neon URL → acceptance test is `docs/DEPLOY-NEON.md` (user runs it on first real deploy: record a payment succeeds = transactions live; overpay rejected; data persists across redeploy). **Neon runtime = DEPLOY-verified, not CI-verified.** This is the last blocker for a persistent (non-demo) deployment; the demo Netlify path is unaffected (no DATABASE_URL → still pglite). | core |
| `3db3a74` | Merge C-7: hardening pass — three accumulated review chips converted to shipped fixes (no migration/deps; 2229 tests green, build clean). (1) `__setTestDb` (the test seam exported from **14** "use server" action files) now no-ops outside the test env (`NODE_ENV!=="test" && !VITEST`) so it can't be POST-invoked in prod to poison `db()` — regression test `test/lib/actions-test-seam-guard.test.ts` (review empirically mutated the guard away → red, proving it real). (2) `src/app/safePanel.ts` wraps each dashboard panel-data fetch in `page.tsx` so a throw degrades to the reader's genuine empty shape (Sentry-captured with `tags:{area:"dashboard-panel",panel}`) instead of 500ing the whole page; the deal-independent `getTodaysBidsForOwner` is wrapped too (review catch); shared `EMPTY_*` fallbacks frozen. Residual (documented, out of scope): a mid-flight per-DEAL read throwing still 500s. (3) `tailwind.config.ts` gained `text: "hsl(var(--text))"` — ~387 `text-text/NN` classes previously emitted no rule and inherited body color; now the alpha variants actually mute (single `--text` def, no theme variant; broad-but-correct visual change worth a human glance on live). **C-8 (Neon transaction driver, the real-deploy blocker) is split into its own open row** — needs a real Neon deploy to verify, so not bundled here. | core |
| `9f324c8` | Merge slice 35b: confirmed write commands — the AI Command Layer's write phase (no migration/deps/new-write-path; ~120 tests, full suite 2225 green, build clean). The command palette gains 3 WRITE commands (record_payment, send_invoice, add_customer_note) behind a preview→Confirm contract. **Load-bearing invariant, review-verified empirically across 12 probes: the AI is NEVER in the execute path.** `runCommand` on a write id calls only `WRITE_COMMANDS[id].preview` (read-only — resolves refs, builds a summary, mutates NOTHING) and returns a `{kind:"confirm", commandId, resolvedParams, summary, details, warning?}` result. `confirmWriteCommand({commandId, resolvedParams})` is the SOLE mutation point (grep-confirmed the only `.execute()` caller), reached only by the human's Confirm click; `execute` is a thin passthrough to the existing guarded action (recordPayment/sendInvoice/saveCustomerStyleNote) — that delegate is the security boundary (re-derives orgId from its own session, re-validates Zod, re-checks org/status/overpay/demo/audit). NO signing between preview and confirm (a forged confirm can't exceed the user's own authority — empirically: cross-org resolvedParams → Forbidden, overpay → the transactional guard). Demo has a single source (the delegate's message). Object.hasOwn whitelist on both commandId entry points; Sentry tags-only (never resolvedParams/question). Files: `src/lib/command/writeRegistry.ts` (+route.ts/actions.ts/registry.ts extensions), `CommandPalette.tsx` Confirm/Cancel card. Destructive/terminal writes (void) deliberately excluded from the first AI-write slice. | core |
| `db808f8` | Merge slice 35a: read-only AI command palette — the AI Command Layer's safe first phase (no migration/deps/writes; ~100 tests, full suite 2160 green, build clean). `/command`: NL question → whitelisted registry of 8 read-only commands (`src/lib/command/registry.ts`) → org-scoped readers → inline `CommandResult` (stat/table/list/help). **The AI only routes** (question→{command,params}); it NEVER sees business data, so hallucinated numbers are structurally impossible — every figure comes from deterministic readers. Keyless/demo uses a pure rules matcher (`routeByRules`); the AI path (`routeCommand`) degrades to the help result on ANY parse/validation/seam failure (balanced-brace JSON scanner; Object.hasOwn whitelist). `runCommand` action skips the demo guard (read-only, keyless-capable — the slice-37 draftEmail precedent) but enforces session; the question never reaches Sentry. Routing note: "who owes me money" → unpaid_by_customer (owing ≠ overdue). Palette is router-free, imports only the CommandResult TYPE from the registry (server module stays out of the client bundle — grep-verified). **35b (confirmed WRITE actions) split into its own open ROADMAP row** — reuses this substrate behind a preview+confirm contract. | core |
| `013df82` | Merge slice 37: AI email drafting + personality memory (migration `0023_dry_sabra`: drafting_prefs org-unique + customers.style_note; ~120 tests, full suite 2078 green — the 2,000 mark crossed; build clean). Customer edit page gains DraftEmailPanel: intent → grounded draft (subject+body editable) → send via the slice-25 seam (feature "drafting") or copy; collapsible voice section (org tone/signature via upsert + per-customer style note). Structural PII: DraftingContext has NO email field (hasEmail boolean; address looked up org-scoped at send time); prompts carry name+aggregates per the slice-36 precedent. `draftEmail` deliberately skips the demo guard (read-only, seam simulates in demo — session/org enforcement empirically verified by review); `sendDraft` fully guarded, signature appended once at send, subject kept OUT of audit summaries. Review (approve, no blockers) closed pre-merge: simulated drafts embedded the PRIVATE style note in the sendable body (Resend-live + AI-keyless would mail it to the customer); CRLF subject loss; markdown-fence residue; DRAFT_INTENTS moved to a dependency-free types.ts so the client bundle can't drag the ai SDK (structural, not tree-shaking-dependent). | core |
| `a2e622f` | Merge slice 41: investor update auto-generator (read-only, no migration/deps; ~52 tests, 1967 green, build clean). One click on /company/projections → one-page PDF: KPI grid + 3-paragraph AI narrative via the slice-32 seam ("investor-update" feature, fast tier ≈$0.002/request); keyless → deterministic template narrative from the same KPIs + a painted SIMULATED NARRATIVE banner (reviewer verified by decoding the PDF content streams). Aggregates-only `InvestorKpis` type = structural PII prevention (no-@ prompt test). GET /company/investor-update/pdf: 503 JSON on narrative failure, never a broken PDF. Rollover-safe UTC month windows (integer arithmetic, empirically probed at Jan-31/Dec-31 anchors). Review: approve, no blockers; fixes landed: empty-narrative guard, void/filename test pins, cost-note honesty (the AI seam enforces NO budget — backstop is auth + gateway credit ceiling). NOTE for slice 37/35: `toWinAnsiSafe` + `wrapText` now exported from invoices/pdfModel; `formatRunwayVerdict` exported from investor/narrative. | core |
| `e77456e` | Merge slice 33: predictive cash runway panel (first post-arc slice; read-only, no migration/deps; ~43 tests, 1907 green, build clean). Pure compute (`src/lib/runway/compute.ts` — UTC-string date math, DST-immune) + readers (`src/db/runway.ts` — org-scoped receivables via the slice-29 JOIN; legacy single-tenant `profit_months` read as-is, now tracked as ROADMAP C-6) + `CashRunwayPanel` registry entry "cash-runway" (getEffectiveLayout auto-appends to persisted layouts). Review (verdict merge, no Critical/Major): −0 avg rendered "-$0.00" fixed; NaN-date guard; ORDER BY id tiebreaker. Chips filed: dashboard-wide per-panel failure degradation (pre-existing — no try/catch in page.tsx at all); sitewide Tailwind `text` color gap (`text-text/*` classes compile to nothing, ~356 usages). Demo: $11,940 receivable vs −$8,500/mo burn → live runway figure. | core |
| `6058b45` | Merge slice 30: WinJewel invoice history import W6 (no migration, no deps; ~170 tests, full suite 1858 green, next build clean twice). Preset (`src/lib/invoices/import/winjewelInvoicePreset.ts`) + one-transaction idempotent commit (`onConflictDoNothing().returning()` — re-running a file creates/pays nothing new, empirically locked incl. mid-file-failure rollback) + `/invoices/import` wizard mirroring the customers template. Customer matching: external_ref exact then case-insensitive name, ambiguity skips. Review (verdict merge, no Critical/Major): comma-grouping validation now rejects EU-format money that silently misparsed ("1.234,56" → $1.23); INSERT-direction 23503 mapped to "run preview again"; future issue dates skip; suggestInvoiceNumber caps sequence length (float-overflow on 44-digit imports); pgErrorFields now exported from actionErrors. Gotcha learned: never write the literal @vitest-environment string in test-file prose comments (docblock scanner matches anywhere). **Migration arc W1–W6 COMPLETE.** | aiya-jewelry |
| `500fd77` | Merge slice 29: Payments + balance tracking W5 (migration `0022_volatile_shadow_king`, ~85 tests, full suite 1689 green + next build twice). Balance derived (total − SUM), paid-state a badge not a status; recordPayment issued-only with a transactional overpay guard (exact-boundary tested; serializes on pglite — on a future neon-serverless driver needs SELECT…FOR UPDATE, and today neon-http throws on transaction() so server deploys fail closed: both tracked as chips, alongside a __setTestDb production-guard chip); deletePayment works at any status (cleanup path) and is now an atomic DELETE…RETURNING after the review reproduced a concurrent double-delete double-logging the audit trail. payment_recorded/payment_deleted verbs ride entityType invoice so history lands in the invoice's own feed. PaymentsPanel on edit (issued+void), Balance/Paid column on the list (single org-scoped JOIN SUM). Slice 30 (WinJewel history import, W6) is next in the arc. | core |

### 1.2a Netlify deploy state (2026-06-21)
**Live deploy is still stuck on the pre-slice-22 build.** Same symptoms as before — `/` returns 200 without the sidebar `Customers` entry; `/customers` 404s from cached prior-build prerender. Root cause: the Netlify account is out of credits; the webhook fires but the build never runs. Plan unchanged: user switches to a paid Netlify account, then push an empty `chore(deploy): retrigger` commit or just re-push (`git commit --allow-empty -m "chore(deploy): retrigger Netlify build for slices 22 + 24"`). After that, verify against the Step 7 checklist in `docs/superpowers/plans/2026-06-08-slice-22-phase-D-completion.md`, then add a slice-24 verify (visit `/customers/2201/edit` — once 24c lands the Activity tab will show events; for now confirm `/customers` still renders the demo seed AND no 500s in the dashboard from slice 24's instrumentation).

### 1.2b Activity feed arc — COMPLETE (24 → 24b → 24c)
All three phases shipped: 24 (`09986bf` primitive + customers instrumentation), 24b (`2464acc` deals/circles/inventory instrumentation — 18 handlers), 24c (`ed432b0` UI: shared `ActivityList`, dashboard `ActivityPanel`, `/activity` route with filter chips + link-cursor pagination, per-customer Activity section on the edit page). Slices 36 (Customer Health Score) and 38 (Anomaly Sentinel) can now consume the log. Deferred by design: live push (slice 52), payload/diff rendering (polish), retention policy (slice 38).

### 1.3 What is on a branch but NOT yet merged
**Branch:** `feature/slice-22-customers` (pushed to origin, tip `4b141d4`)
**Worktree:** `.worktrees/slice-22-customers/`
**Migration:** `drizzle/0016_left_starbolt.sql` (customers table)

13 commits ahead of main, covering:
- Phase A — customers table schema + 0016 migration + `getCustomers` + `getCustomerById`
- Phase B — Zod schemas + `createCustomer`/`updateCustomer`/`deleteCustomer` actions + authz truth-table tests
- Phase C — `DEMO_CUSTOMERS` seed + `<CustomersTable>` + `<CustomerForm>` + 3 RSC pages (`/customers`, `/customers/new`, `/customers/[id]/edit`) + sidebar `Customers` link + 4 component test files
- Review fixes — see §1.5

### 1.4 What is in-flight (background task)
Full vitest suite is running on the slice-22-customers worktree as the final pre-merge verify:

- **Task id:** `bnxr6msgy`
- **Output file:** `/private/tmp/claude-501/-Users-claytonhillyard-Downloads-dashboard-project--root/8a166f8f-1ed7-40fb-b52a-0a1334501631/tasks/bnxr6msgy.output`
- **Started:** ~05:50 (≈ 7 min runtime expected for pglite tests)
- **Expectation:** all green. Targeted runs already passed (76 customer/action tests + 3 smoke tests + 5 Nav tests + form/table tests).

The next session should `tail` the output file to confirm exit status before proceeding to Phase D merge.

### 1.5 Review findings already addressed (commit `be5bebe`, `4b141d4`)

Two parallel reviews ran against `b481b90`. Findings applied:

🚫 **BLOCKER — `externalRef` closed off from slice 22 surface.** Removed from Zod schemas, actions, form. The DB column + partial-unique index stay; slice 26 (WinJewel CSV import) is the only writer.

⚠️ **MAJORs applied:**
- Migration smoke test added (`test/db/migration-customers-smoke.test.ts`) — proves the partial-unique on `(org_id, external_ref)` survives migration round-trip
- Symmetric Sentry action tags (`run()` wrapper takes required `action` opt)
- Sentry + log PII scrub via `safeErrShape()` — drops PG `detail`/`hint`/`where`/`parameters` which carry customer email/phone/address
- Postgres unique-violation friendly mapping via `mapDbConstraintError()`
- Nav active state actually moves — extracted `NavItem` client component using `usePathname`; added `Dashboard: "/"` to ROUTES

💡 **MINORs deferred to follow-up slice (NOT blocking merge):**
- Delete uses `window.confirm()` instead of a styled modal
- No per-row Delete in `<CustomersTable>` (only in edit page)
- Address fieldset always open instead of toggled (spec wanted closed-by-default in create)
- Repeated label/input pattern in `<CustomerForm>` (~120 lines could be extracted to `<Field>` subcomponent)
- `getCustomers` doesn't escape SQL wildcards `%` and `_` in user-typed search
- `force-dynamic` on `/customers/new` is unnecessary (static shell)
- `addressInput` missing `.strict()` — allows extra JSONB keys
- Phase A's `customers_org_external_ref_unique` partial-unique IS proven by the new smoke test (no longer a gap)
- The Sentry-PII pattern fix needs back-porting to other slices' actions (`deals/actions.ts`, etc.) — pre-existing systemic issue

The MINORs should be tracked as task **#92 — Slice 22 polish follow-up** if not already.

---

## 2. Next step (do this first)

Read `docs/superpowers/plans/2026-06-08-slice-22-phase-D-completion.md`. It's a 10-step execution playbook. Summary:

1. Confirm the in-flight vitest suite (§1.4) finished green
2. Merge `feature/slice-22-customers` → `main` with `--no-ff`
3. Push `main` (triggers Netlify auto-deploy)
4. Update `docs/ROADMAP.md` §9 row 22 to `shipped: <sha>`
5. Update task tracker (#35, #59, #60) to completed
6. Verify the Netlify deploy succeeds and `/customers` renders the demo seed
7. Open task #92 for deferred MINORs

After Phase D: the next core slice in the queue is **slice 24 (Activity feed)** or **slice 23 (AI image-to-listing)** — both ROADMAP §9 entries with no claimed owner.

---

## 3. Everything else

### 3.1 Branch + worktree map

```
main                              743a766  (C-1 + strategy docs)
feature/slice-22-customers        4b141d4  (A + B + C + review fixes — ready to merge)
slice-C-1-module-skeleton         bddf987  (merged into main; branch can be deleted)
```

```
.worktrees/
  slice-22-customers/             ← Phase D will merge from here
  slice-C-1-module-skeleton/      ← can be removed
```

### 3.2 Coordination protocol with the other tab

Both tabs MUST do this before claiming a slice:

1. `git pull origin main` to get the latest ROADMAP
2. Open `docs/ROADMAP.md` §9
3. Find the slice; change `Owner: open` → `Owner: <tab-label>` + timestamp in Notes
4. Commit + push the roadmap edit BEFORE any feature work
5. Work in a worktree (`.worktrees/slice-N-<name>/`)
6. On done: mark §9 row `Status: shipped: <merge-sha>`

If both tabs claim the same slice simultaneously, the lower-SHA commit wins. The other tab releases.

### 3.3 Migration-number coordination

Each tab generates migrations against `main` at the time it starts. Two simultaneous slices land the same number. **Resolution pattern:** skip the migration commit during rebase; regenerate with `npx drizzle-kit generate` once the rebase has settled. Worked example: slice 22 Phase A's `0015_wise_mariko_yashida` was dropped during rebase onto post-C-1 main, then regenerated as `0016_left_starbolt` (only the customers table — `module_id` was already on `orgs` from C-1's `0015_naive_chamber`).

### 3.4 Known gotchas

- **No ESLint config.** TSC is the static-analysis source of truth. Subagent prompts should NOT ask for `npx eslint` — it'll fail with "no config" instead of "no errors".
- **Background commands mask vitest exit codes via pipes.** `npx vitest run 2>&1 | tail` returns 0 from `tail` regardless of vitest's exit. Always check the output file for the trailing `Test Files X failed | Y passed` line. The harness's `<task-notification>` exit status reports `tail`'s exit, not vitest's.
- **pglite swallows the Postgres SQLSTATE.** Tests for unique-violation can't reliably assert `e.code === '23505'` or `e.message.includes('duplicate')`. Use row-count after the throw instead (see slice-22 smoke test).
- **Semgrep CWE-134.** Any `console.log/error` whose format string contains a template literal with a variable trips the format-string rule. Use a constant format string + structured extras: `console.error("...", { extra })`.

### 3.5 Useful one-liners

```bash
# State of every branch
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git branch --format='%(refname:short)  %(objectname:short)  %(committerdate:relative)'
git worktree list

# Are we behind origin?
git fetch origin && git log --oneline main..origin/main | head -5

# Is anything still running?
ps aux | grep -E "vitest|tsc.*noEmit|npm" | grep -v grep | head -5

# Slice 22 worktree state
cd .worktrees/slice-22-customers && git log --oneline main..HEAD
```

### 3.6 What was learned (worth memorizing)

- The "command center" was always meant to be generic; the AIYA jewelry framing crept in via the parallel tab's slice numbering. Now formalized as shell + module — no future drift.
- The Sentry+PII pattern (`safeErrShape` + `mapDbConstraintError`) introduced in slice 22 actions should be back-ported to every slice's `actions.ts` that handles user-supplied PII. Track as a follow-up.
- Two-reviewer pattern (spec-compliance + code-quality, independent) caught both the architectural BLOCKER (externalRef) and the missing test (smoke). Worth repeating on every slice.

### 3.7 Files to read before resuming

In order of importance:
1. `docs/ROADMAP.md` — the strategic source of truth (§9 for current slice queue + ownership)
2. `docs/MODULES.md` — shell vs module contract
3. `docs/CODE_AUDIT.md` — file-by-file core/module classification
4. `docs/HANDOFF.md` — this file
5. `docs/superpowers/plans/2026-06-08-slice-22-phase-D-completion.md` — next step
6. `docs/worktrees.md` — worktree workflow

### 3.8 Outstanding strategic questions (ROADMAP §8)

These don't block Phase D, but the next session may want to answer them:

- Q1 — Invoices: core schema + module templates? **Recommendation:** yes, same pattern as categories. (Slice 27.)
- Q2 — Pricing model (per-seat / per-tenant / per-module)? **Recommendation:** defer until 2nd customer.
- Q3 — AR viewer: build or partner? **Recommendation:** partner first (Pixyle, Threekit).
- Q4 — Voice features: Web Speech only or Whisper too? **Recommendation:** both — Web Speech for browser commands, Whisper for transcription-of-record.
- Q5 — Single-module-per-tenant or multi? **Recommendation:** single until marketplace era.
