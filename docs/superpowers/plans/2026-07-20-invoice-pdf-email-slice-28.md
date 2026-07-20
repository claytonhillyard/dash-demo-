# Slice 28 — Invoice PDF + Email Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Issued invoices become sendable — pdf-lib-generated PDF (download any status, email attach issued-only), `sent_at`/`sent_to` tracking, the slice-25 seam's first real consumer.

**Spec (authoritative — read cited §§ first):** `docs/superpowers/specs/2026-07-20-invoice-pdf-email-slice-28-design.md`

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-28-invoice-send`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed (base — 28-2 adds pdf-lib); TDD failing-first; NO detached full-suite runs; shared-db harness; demo RSC harness; zod v4 `z.email()`; generous timeouts on DB batches; the `run()` scaffold + `@/lib/actionErrors` conventions.

**Reference files:** `src/lib/email/sendEmail.ts` + `types.ts` (the seam to extend), `src/lib/invoices/actions.ts` (sendInvoice lands HERE, same scaffold), `src/db/invoices.ts` (InvoiceDetail to extend with sentAt/sentTo), `src/db/schema.ts` invoices table, `test/lib/email/sendEmail.test.ts` (mocked-fetch conventions), `test/app/invoices-pages.test.tsx` (demo harness), `src/components/invoices/InvoiceStatusActions.tsx` (client-component conventions).

---

## Task 28-1 — Seam attachments + migration 0021 + verb + query fields

**Files:** modify `src/lib/email/types.ts` (+`EmailAttachment`, `attachments?` on SendEmailInput per spec §4), `src/lib/email/sendEmail.ts` (Zod: attachments max 3, filename 1..100 trimmed, content non-empty base64 ≤ 10_000_000 chars, contentType 1..100; Resend body gains `attachments: [{ filename, content }]` when present; simulated path ignores), `src/db/schema.ts` (invoices += `sentAt` timestamptz mode:"date" NULL, `sentTo` text NULL — house comment conventions), `src/lib/activity/types.ts` (+`"sent"` verb, lifecycle group), `src/components/activity/ActivityList.tsx` (`sent` → the emerald/sky group — pick sky (outbound comms), extend dot-map test), `src/db/invoices.ts` (InvoiceDetail + list row gain `sentAt: Date | null`, `sentTo: string | null`; demo seed 9302 gains a sent example — coordinate `src/lib/demo/seed.ts` + its integrity tests); generate `drizzle/0021_*.sql`; extend `test/db/invoices-migration-smoke.test.ts` (+2: columns exist nullable) + `test/lib/email/sendEmail.test.ts` (+~5 attachment cases: serialized into mocked fetch body base64+filename; omitted when absent; simulated ignores; Zod rejects >3 / empty filename) + seed integrity.

Verify scoped (email + smoke + seed + invoices db + ActivityList) + tsc. Commit `feat(email,db): attachment support + invoice sent tracking (slice 28-1)`.

## Task 28-2 — pdf-lib + model/painter

**Files:** `npm install pdf-lib --save` (check `npm view pdf-lib version` first, report resolved); create `src/lib/invoices/pdfModel.ts` (spec §3.1 EXACTLY — pure; import InvoiceDetail + formatCentsExact; wrapping at 90 chars/line for descriptions + notes via a small pure `wrapText(s, width): string[]`; address flattening reuses the slice-22 shape's fields in street1/street2/city+state+zip/country line order; meta rows omit null dates as "—"; tax line omitted at 0 bps; banner per status), `src/lib/invoices/pdfRender.ts` (spec §3.2 — Letter, Helvetica + Bold via StandardFonts, margin 50, y-cursor, page-break helper, banner text drawn light-gray 48pt rotated? NO — keep it simple: large light-gray horizontal text above the header; document the choice), tests `test/lib/invoices/pdfModel.test.ts` (~15: per spec §7 model cases — drive with the demo seed invoices via `getSeedInvoiceById` where convenient + synthetic edge rows) + `test/lib/invoices/pdfRender.test.ts` (~4 integration: render seed 9302's model → bytes start `%PDF-`, `PDFDocument.load` succeeds, `getPageCount() === 1`; synthetic 50-item × 200-char-description invoice → page count ≥ 2; DRAFT banner model renders without throwing; empty-notes model fine).

Verify + tsc. Commit `feat(invoices): PDF model + pdf-lib renderer (slice 28-2)`.

## Task 28-3 — sendInvoice action + PDF route

**Files:** modify `src/lib/invoices/actions.ts` (+`sendInvoice` per spec §5.2 — same file/scaffold; needs orgName: `SELECT name FROM orgs WHERE id = orgId`; base64 via `Buffer.from(bytes).toString("base64")`), create `src/app/(admin)/invoices/[id]/pdf/route.ts` (spec §5.3 — GET handler: try requireSession catch → 401 JSON in live mode, but demo mode short-circuits FIRST via isDemoMode() → orgId 1 (mirror how getCurrentOrgId handles demo); getInvoiceById → 404; model+render; Response with the three headers; filename sanitized: strip `"` and CR/LF from the number), tests `test/lib/invoices/actions.test.ts` (extend, ~12: the spec §7 sendInvoice truth table — mock `@/lib/email/sendEmail` via vi.mock; assert stamping via re-fetch; audit "sent" + no-@ guard) + `test/app/invoice-pdf-route.test.ts` (~5: demo-mode GET via calling the route handler directly with a Request + params promise — 200 headers + bytes load for seed 9302; 404 unknown id; draft 9301 renders (banner path); filename sanitization unit case via exported helper or a crafted number in a live-mode shared-db case — implementer's judgment on harness, note it).

Caveats: `sendInvoice` must NOT stamp on `simulated: true` but return the flag; the route imports the model/painter directly (no action indirection); Buffer available in route handlers (node runtime — verify the route isn't edge: no `export const runtime` = node default, fine).

Verify (invoices actions + new route test + tsc). Commit `feat(invoices): sendInvoice action + PDF download route (slice 28-3)`.

## Task 28-4 — Send panel + edit-page wiring

**Files:** create `src/components/invoices/SendInvoicePanel.tsx` (spec §6 — client: props `{ id, billToEmail: string | null, sentAt: Date | null, sentTo: string | null }`; email input prefilled; Send → `sendInvoice({ id, toEmail: typed || undefined })`; pending/alert; ok+simulated → "Simulated — set RESEND_API_KEY for live sends" note; ok real → router.refresh; sent-state line via relativeTime), `test/components/invoices/SendInvoicePanel.test.tsx` (~6: prefill, send payload, simulated note, real-send refresh, error alert, sent-state line render); modify `src/app/(admin)/invoices/[id]/edit/page.tsx` (Download PDF `<a>` in the header for all statuses; SendInvoicePanel rendered only when status issued — pass billTo email + sent fields); extend `test/app/invoices-pages.test.tsx` (+3: download link present on draft + issued; send panel present on issued only; sent-state visible for seed 9302).

Verify (components/invoices + invoices pages + tsc). Commit `feat(invoices): send panel + PDF download on edit page (slice 28-4)`.

---

## Final verification (controller)

Full suite detached → expect ~1556 baseline + ~40 ≈ 1596, VITEST_EXIT=0. tsc → 0. Final review probes: attachment PII discipline, simulated-no-stamp semantics, route auth/404/headers + filename sanitization, model/painter split purity, page-break correctness, pdf-lib dep hygiene. Merge → docs → cleanup slice-27 worktree.

## Done condition

- 4 commits + docs; migration 0021; ONE new dep (pdf-lib, approved)
- Demo: seed 9302 downloads a valid PDF; send blocked in demo (run() guard) but the panel renders with the sent-state example
- Full suite green; tsc clean; ROADMAP row 28 shipped
