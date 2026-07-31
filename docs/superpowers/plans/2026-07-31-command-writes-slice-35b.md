# Slice 35b — Confirmed Write Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Write commands in the palette behind a preview→Confirm contract. **The AI never executes** — Confirm delegates to the EXISTING guarded actions (recordPayment/sendInvoice/saveCustomerStyleNote). No migration, no new deps, no new write path.

**Spec (authoritative — read cited §§ first, ESPECIALLY §1 + §3's security invariant):** `docs/superpowers/specs/2026-07-31-command-writes-slice-35b-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-35b-write-commands`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string in prose comments; "use server" export rules; a silent exit-1 may be the flapping host sandbox — retry before believing it.

**Reference files:** `src/lib/command/registry.ts` + `route.ts` + `actions.ts` (35a — the substrate to extend), `src/lib/payments/actions.ts` (recordPayment — its exact input Zod shape), `src/lib/invoices/actions.ts` (sendInvoice — input shape, issued-only), `src/lib/drafting/actions.ts` (saveCustomerStyleNote — input shape), `src/db/invoices.ts` + `src/db/runway.ts` (invoice/balance readers for preview resolution), `src/lib/invoices/import/winjewelInvoicePreset.ts` (parseMoneyToCents/normalizeDate to reuse), `src/components/command/CommandPalette.tsx` (35a palette to extend), `test/lib/command/*` (the 35a test patterns).

---

## Task 35b-1 — Write command registry (preview + execute)

**Files:** `src/lib/command/writeRegistry.ts` (spec §4 EXACTLY — `WRITE_COMMAND_IDS`, `WriteCommandId`, `WritePreview`, `WriteCommandDef`, `WRITE_COMMANDS` record; the 3 commands' `preview` (READ-ONLY resolution — reuse parseMoneyToCents/normalizeDate from the winjewel preset, invoice-number resolution + balance read, customer resolution; 0/2+/wrong-status → ok:false with helpful message) and `execute` (re-validate via the delegate's own Zod by just CALLING it — `execute(resolvedParams)` = `recordPayment(resolvedParams)` etc.; NO business logic duplicated); import the three delegate actions). Tests `test/lib/command/writeRegistry.test.ts` (~20, shared-db per spec §7 preview + execute rows: happy previews build exact resolvedParams; resolution 0/1/2+; wrong-status/no-email → ok:false; **preview mutates NOTHING (table counts unchanged)**; execute delegates + returns the action result; forged cross-org resolvedParams → the delegate's Forbidden; demo → the delegate's demo message; overpay-at-execute; audit written by the delegate).

Verify scoped + tsc. Commit `feat(command): write command registry — preview + delegating execute (slice 35b-1)`.

## Task 35b-2 — Router extension + confirm action + result variant

**Files:** `src/lib/command/registry.ts` (add the `confirm` variant to `CommandResult` per spec §3.1); `src/lib/command/route.ts` (extend the catalog + `RoutedCommand` union with the 3 write ids; `routeByRules` write keyword lists + routeParams heuristics per spec §5; read/write disambiguation — imperative verb → write, bare noun → read; the AI system catalog appends write ids/descriptions/hints, STILL static; Object.hasOwn whitelist covers write ids); `src/lib/command/actions.ts` (extend `runCommand`: a routed WRITE id → call `WRITE_COMMANDS[id].preview(db, orgId, params)` → ok → return the `confirm` result (ZERO mutation); ok:false → `{ok:false, error}`; a read id → unchanged 35a path. Add `confirmWriteCommand({commandId, resolvedParams})` per spec §3.2 — hand-rolled session-first, NO demo short-circuit (delegate guards), Object.hasOwn commandId whitelist, `WRITE_COMMANDS[id].execute(resolvedParams)`, 35a try/catch Sentry tags-only, resolvedParams NEVER captured). Tests: extend `test/lib/command/route.test.ts` (~10 — write routing + disambiguation + AI write JSON + whitelist), extend `test/lib/command/actions.test.ts` (~12 — runCommand write→confirm result mutates nothing; read still works; preview-fail message; demo still previews; confirmWriteCommand happy/demo-blocked/unauth/forged-id/no-resolvedParams-in-Sentry).

Verify scoped + tsc. Commit `feat(command): route write commands + confirmWriteCommand action (slice 35b-2)`.

## Task 35b-3 — Palette confirm UI

**Files:** `src/components/command/CommandPalette.tsx` (extend per spec §6 — the `confirm`-kind renderer: summary + details + amber warning + Confirm/Cancel; Confirm → `confirmWriteCommand({commandId, resolvedParams})` useTransition pending, ok→success line (real vs simulated), ok:false→error in card, Cancel→discard; single-flight; history records confirmed/cancelled/failed). Tests: extend `test/components/command/CommandPalette.test.tsx` (~5 — confirm result renders summary/details/warning/buttons; Confirm calls the action with the EXACT commandId+resolvedParams from the result; Cancel makes no call; simulated note; error-in-card) — mock `@/lib/command/actions`.

Verify scoped + tsc + `npx next build` (client-graph check — writeRegistry.ts pulls the db + delegate actions; the palette must import only the CommandResult TYPE + the two actions, NEVER writeRegistry.ts as a value). Commit `feat(command): confirm UI for write commands (slice 35b-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits. `npx tsc --noEmit`. `npx next build`. Review probes (the security invariant is the whole review): **prove the AI is never in the execute path** (routeCommand/preview touch no writer; only confirmWriteCommand→delegate mutates); a forged/tampered confirm can't exceed the user's authority (cross-org, demo, overpay, wrong-status all caught by the delegate — empirically); preview is genuinely read-only (table counts); no new audit verbs / no duplicated write logic in execute; org-scoping via the delegates; Sentry never gets resolvedParams or the question; read/write routing disambiguation can't misfire a write from a bare-noun read; client bundle (writeRegistry stays server-side); Object.hasOwn whitelist on both commandId paths; the demo message has a single source (the delegate). Apply fixes → scoped re-verify → merge --no-ff → ROADMAP row 35b shipped + HANDOFF → clean up `.worktrees/slice-35a-command-palette` + branch.

## Done condition

- 3 commits + docs; zero new deps; no migration; NO new write path (delegation only)
- Demo: "record a $500 payment on INV-2026-0001" → a confirm card with the right summary; Confirm → the delegate's demo-mode message (nothing written); a read question still answers
- Full suite green; tsc clean; next build clean; ROADMAP row 35b shipped
