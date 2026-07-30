# Slice 37 — AI Email Drafting + Personality Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Customer edit page: intent → grounded AI draft (subject+body, editable) → send via the slice-25 seam or copy. Org voice (tone/signature) + per-customer style note feed the prompt. Keyless → deterministic simulated drafts.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-22-email-drafting-slice-37-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-37-email-drafting`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; NEVER write the literal `@vitest-environment` string in prose comments; route/"use server" export rules.

**Reference files:** `src/lib/customers/healthInsight.ts` (prompt-PII precedent), `src/lib/investor/narrative.ts` (seam-call + simulated-substitution + error-mapping precedent, incl. the empty-response guard), `src/lib/invoices/actions.ts` + `src/lib/payments/actions.ts` (run() scaffold + FriendlyError to mirror), `src/lib/email/sendEmail.ts` + `types.ts`, `src/db/runway.ts` (balance derivation), `src/lib/sentinel/` (latest-snapshot idiom), `src/components/invoices/SendInvoicePanel.tsx` + `PaymentsPanel.tsx` (client conventions), the customer edit page (insight-card placement + data loads), `test/lib/payments/actions.test.ts` (fixtures).

---

## Task 37-1 — Migration 0023 + prefs/style-note actions + email feature

**Files:** `src/db/schema.ts` (+`drafting_prefs` per spec §3 verbatim; `customers` += `styleNote: text("style_note")` with house comment); `npx drizzle-kit generate` → inspect `drizzle/0023_*.sql` additive-only, report filename; `src/lib/email/types.ts` (`EMAIL_FEATURES` += `"drafting"` — grep email tests for list assertions and ripple); `src/lib/drafting/actions.ts` (new "use server" — the run() scaffold copied per house pattern with FriendlyError; ONLY `saveDraftingPrefs` + `saveCustomerStyleNote` this task, per spec §6: upsert `onConflictDoUpdate` on the org unique; org-scoped customers update, empty→NULL; audits with payload {}); `src/db/drafting.ts` (new: `getDraftingPrefs(db, orgId)` → `{tone, signature} | null`, demo branch returning a deterministic demo voice); ripple: customers row types/factories gaining styleNote (grep `InvoiceForm`-style customer factories + `src/db/customers.ts` shapes — extend where tsc demands). Tests: migration smoke +3 (find the right smoke file — customers columns live where slice-22's smoke tests are), `test/lib/drafting/actions.test.ts` (start it: prefs upsert-twice-one-row, tone/signature caps, style note org-scoped + empty→NULL + cross-org Forbidden + audits with no-@ stringify guard, demo-blocked both), getDraftingPrefs reader test (+2 incl. demo branch).

Verify scoped + tsc. Commit `feat(drafting): prefs schema + style note + save actions (slice 37-1)`.

## Task 37-2 — Context + generate + draft/send actions

**Files:** `src/lib/drafting/context.ts` (spec §4 verbatim — reuse the slice-29 balance JOIN shape org-scoped, latest-snapshot band via the sentinel idiom, last-5 activity summaries via the activity readers, hasEmail boolean ONLY); `src/lib/drafting/generate.ts` (spec §5 — DRAFT_INTENTS, buildDraftPrompt, parseDraft defensive table, simulatedDraft deterministic, generateEmailDraft core mirroring `src/lib/investor/narrative.ts`'s seam handling INCLUDING the empty-response→error guard); extend `src/lib/drafting/actions.ts` (+`draftEmail` — the documented demo-guard SKIP per spec §6/§9, session+org still enforced, no audit/revalidate; +`sendDraft` — fully guarded, signature-at-send, seam call feature "drafting", audit verb "sent" entityType "customer" summary without subject, revalidate). Tests: `test/lib/drafting/context.test.ts` (~8 per spec §8 incl. the structural no-@ serialization), `test/lib/drafting/generate.test.ts` (~12 per spec §8 — mock the AI seam), extend `test/lib/drafting/actions.test.ts` (~14 total per spec §8 — draftEmail demo-ALLOWED test locked, sendDraft demo-blocked, signature appended exactly once, audit no-@).

Verify scoped + tsc. Commit `feat(drafting): context + draft generation + send actions (slice 37-2)`.

## Task 37-3 — Panel + customer edit wiring

**Files:** `src/components/customers/DraftEmailPanel.tsx` (spec §7 — client; conventions from SendInvoicePanel/PaymentsPanel; clipboard copy with a mocked-clipboard test; collapsible voice section housing prefs + style note saves); customer edit page (find it — slice 22's edit page with the 36 insight card; add org-scoped prefs + styleNote loads, render the panel near the insight card, pass primitives only). Tests: `test/components/customers/DraftEmailPanel.test.tsx` (~8 per spec §8 — mock `@/lib/drafting/actions` + navigator.clipboard + next/navigation; the edited-body-is-what-sends assertion matters) + extend the customer edit page RSC test (+2 — seed customer 2204 has an email; intent select present; style note threaded).

Verify scoped + tsc. Commit `feat(drafting): draft email panel on customer edit (slice 37-3)`.

---

## Final verification (controller)

Full suite detached AFTER all commits. `npx tsc --noEmit`. `npx next build`. Review probes: the demo-guard deviation (draftEmail) — session/org enforcement empirically intact; prompt/context PII (no addresses anywhere in the AI path — adversarial serialization); signature exactly-once (resend after edit?); parseDraft against hostile model output (markdown, no markers, 10k chars, subject-only); audit hygiene (no subjects/emails); EMAIL_FEATURES/AI_FEATURES ripples; migration 0023 chain; upsert race on drafting_prefs (concurrent saves — onConflictDoUpdate should be atomic, verify); panel clipboard fallback when navigator.clipboard undefined; customers.styleNote ripple completeness. Apply fixes → scoped re-verify → merge --no-ff → ROADMAP row 37 `shipped:` + HANDOFF → clean up `.worktrees/slice-41-investor-update` + branch.

## Done condition

- 3 commits + docs; migration 0023; zero new deps
- Demo: generate a simulated draft for seed customer 2204 end-to-end in the panel; send demo-blocked with the friendly message; voice prefs render
- Full suite green; tsc clean; next build clean; ROADMAP row 37 shipped
