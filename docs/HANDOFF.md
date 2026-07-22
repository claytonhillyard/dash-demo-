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
