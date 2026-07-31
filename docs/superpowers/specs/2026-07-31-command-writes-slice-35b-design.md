# iDesign Command Center — Slice 35b: Confirmed Write Commands (AI Command Layer, phase 2) — Design

**Date:** 2026-07-31
**Status:** Approved; implementation plan pending
**Builds on:** slice 35a (the read-only command palette — router, palette, help substrate), slice 29 (recordPayment), slice 28 (sendInvoice), slice 37 (saveCustomerStyleNote), slice 24 (audit).

---

## 1. Overview & Goals

The command palette gains WRITE commands: "record a $500 cash payment on INV-2001", "send invoice INV-2002", "note that Tanaka prefers concise emails". The load-bearing security invariant:

> **The AI is NEVER in the execute path.** It only routes a question to `{command, params}` and helps build a human-readable **preview**. Nothing mutates until the user clicks **Confirm**, and Confirm calls the SAME existing guarded action the normal UI uses (recordPayment / sendInvoice / saveCustomerStyleNote) — with all of its session check, org-scoping, demo guard, Zod, overpay/status guards, and audit intact. The command layer is a *router to* those actions, never a new write path.

**Goals:**
- `src/lib/command/writeRegistry.ts` — 3 write commands, each = `{ preview (read-only resolution), execute (delegates to the existing guarded action) }`.
- Two-phase flow: `runCommand` routes; a write route returns a `confirm` result (preview only, ZERO mutation); a new `confirmWriteCommand` action executes.
- Router (35a) extended to see write commands too.
- Palette (35a) renders the `confirm` variant with Confirm/Cancel + per-command warnings.
- ~45 tests. No migration, no new deps, no new write path (delegation only).

## 2. Non-goals (named homes)

New mutations of any kind (delegation-only — if a write isn't already a guarded action, it's not in 35b). Multi-step / chained commands ("send all overdue invoices" — batch is a later slice). Undo (the underlying actions' own reversibility applies — deletePayment etc.). Voiding invoices via NL (destructive + terminal — deliberately excluded from the first AI-write slice; a later slice can add it once the confirm UX is proven). Free-form param editing in the confirm card (v1: confirm-or-cancel exactly what was previewed; re-ask to change).

## 3. The two-phase contract

### 3.1 Preview (read-only, no mutation)

`runCommand({question})` (35a's action, extended) routes across BOTH registries:
- Read command → execute + return `{ok:true, result, command}` (unchanged 35a behavior).
- Write command → call the write def's `preview(db, orgId, rawParams)` (READ-ONLY: resolves "INV-2001"→invoiceId, "Tanaka"→customerId, parses "$500"→cents; touches only readers) → return a **confirm result**, executing NOTHING:

```ts
// added to CommandResult union (registry.ts):
| { kind: "confirm"; commandId: WriteCommandId; resolvedParams: unknown;
    summary: string; details: Array<[label: string, value: string]>; warning?: string }
```

- `preview` returns `{ ok:false, error }` when it can't build a valid, unambiguous action — missing amount, unresolvable/ambiguous invoice or customer, wrong invoice status for the action — with a helpful message ("Couldn't tell which invoice — try the invoice number, e.g. INV-2001"). The palette shows this as a plain message, no Confirm button.
- `resolvedParams` are EXACTLY the concrete params the underlying guarded action's Zod expects (e.g. `{invoiceId, amountCents, method, receivedDate}`) — so Confirm is a straight pass-through.

### 3.2 Confirm (the only mutation point)

`confirmWriteCommand({commandId, resolvedParams})` (new action):
1. Zod: `commandId` ∈ the write command ids (Object.hasOwn guard, the 35a-review lesson); `resolvedParams` unknown (re-validated next).
2. requireSession (the hand-rolled session-first sequence; orgId from session). **No demo short-circuit here** — it delegates, and the underlying action's OWN demo guard fires, returning the friendly demo message. (Documented: we do not want two different demo messages; the action is the single source.)
3. `WRITE_COMMANDS[commandId].execute(resolvedParams)` → the def re-validates `resolvedParams` against the underlying action's input shape and calls that action (e.g. `recordPayment(resolvedParams)`). Return the action's `ActionResult` verbatim (it already carries ok/simulated/error and has audited on success).
4. Wrap in the 35a try/catch → Sentry tags-only (NO question here — confirm carries no free text beyond resolvedParams, which are structured; still, never capture resolvedParams values, only the commandId tag).

**Why no signing/token between preview and confirm:** the underlying guarded action is the security boundary — it re-checks session, org (`eq(orgId)` in every WHERE), demo, status, overpay, and Zod. A tampered `confirmWriteCommand` payload can do NOTHING the user couldn't already do through the normal UI for their own org. So the preview→confirm handshake carries plain resolvedParams; trust lives in the delegate, not the handshake. (Test locks this: a confirm with hand-forged resolvedParams for a cross-org invoice → the underlying action's Forbidden.)

## 4. Write command registry — `src/lib/command/writeRegistry.ts`

```ts
export const WRITE_COMMAND_IDS = ["record_payment", "add_customer_note", "send_invoice"] as const;
export type WriteCommandId = (typeof WRITE_COMMAND_IDS)[number];

export type WritePreview =
  | { ok: true; resolvedParams: unknown; summary: string; details: Array<[string, string]>; warning?: string }
  | { ok: false; error: string };

export type WriteCommandDef<RouteParams> = {
  id: WriteCommandId;
  description: string;
  examples: string[];
  routeParams: z.ZodType<RouteParams>;                 // what the ROUTER extracts (loose free-text-ish)
  preview(db: Db, orgId: number, params: RouteParams): Promise<WritePreview>;   // read-only
  execute(resolvedParams: unknown): Promise<ActionResult>;                       // delegates to the guarded action
};
export const WRITE_COMMANDS: Record<WriteCommandId, WriteCommandDef<any>>;
```

Commands (escalating side-effect severity — good for showing the confirm contract):

| id | routeParams (from NL) | preview resolves → | delegates to | warning |
|---|---|---|---|---|
| `add_customer_note` | `{customer: string, note: string}` | customer name/business → id (slice-30 resolution; 0/2+ → ok:false) | `saveCustomerStyleNote({customerId, styleNote})` (slice 37) | — |
| `record_payment` | `{invoice: string, amount: string, method?: string, date?: string}` | invoice number → id (must be issued — else ok:false "payments only on issued invoices"); `$500`→cents; method default "other"; date default UTC today; overpay pre-checked in preview (balance read) so the summary can say "brings balance to $X" | `recordPayment({invoiceId, amountCents, method, receivedDate})` (slice 29) | "Records a payment against this invoice." |
| `send_invoice` | `{invoice: string}` | invoice number → id (must be issued); recipient = frozen billTo.email (none → ok:false "no email on file") | `sendInvoice({id})` (slice 28) | "Sends an email to the customer." |

- `preview` money/date parsing reuses the slice-30 `parseMoneyToCents` / `normalizeDate` helpers where possible (import them). Invoice resolution: exact `INV-...` number match first, then a fuzzy contains; 0/2+ → ok:false with the candidates listed.
- `execute` re-validates via the underlying action's own Zod (the action does this itself — execute just calls it and returns the result; execute must NOT duplicate business logic).
- The overpay pre-check in `record_payment`'s preview is a COURTESY (nicer summary); the real guard is recordPayment's transactional check at confirm — the preview number can be stale and that's fine, confirm is authoritative.

## 5. Router extension — `src/lib/command/route.ts`

- The router's catalog (rules keywords + AI system catalog) gains the 3 write commands. Keywords: record_payment → pay/paid/record-payment/received; add_customer_note → note/remember/style; send_invoice → send/email-invoice/send-invoice. AI system prompt catalog appends the write ids + descriptions + param hints (STILL static — no data).
- `RoutedCommand` union gains the write ids. `routeByRules` extracts routeParams heuristically (record_payment: first `$`/number → amount, `INV-\w+` → invoice, method keyword → method; add_customer_note: "note that X …" residual; send_invoice: `INV-\w+` → invoice). AI path validates against the write def's `routeParams` (loose) then hands to preview.
- Ambiguity between a read and a write (e.g. "payments" could be recent_activity vs record_payment) resolved by the scorer; a bare noun with no action verb → read; an imperative verb (record/send/note/pay) → write. Document the tie rules; test them.

## 6. Palette — `src/components/command/CommandPalette.tsx` (35a, extended)

- New `confirm`-kind renderer: the summary (prominent), the details rows, the warning (amber, if present), and a **Confirm** + **Cancel** button pair. Confirm → `confirmWriteCommand({commandId, resolvedParams})` with useTransition pending; on ok → a success line (real vs `simulated` → "Simulated — set the relevant key for live X" mirroring the delegate's flag) and the confirm card collapses to a done state; on `{ok:false}` → the delegate's friendly error (e.g. the demo-mode message, overpay message) shown in the card. Cancel → discard the pending write, clear the card.
- A pending write is single-flight (Confirm disabled while pending; a second question while a confirm is open replaces it — the un-confirmed write simply evaporates, nothing ran).
- The history (last 3) records the QUESTION and, for writes, whether it was confirmed/cancelled/failed (nice provenance; still no persistence).

## 7. Test plan (~45)

- **Write registry preview (~12, shared-db):** each command's happy preview builds correct resolvedParams + summary from seeded data (record_payment: "$500 on INV-... via cash" → {invoiceId, 50000, "cash", today}); invoice/customer resolution 0/1/2+; record_payment on a draft/void invoice → ok:false; send_invoice with no billTo email → ok:false; money/date parse edges; **preview performs ZERO writes (assert table counts unchanged after a preview)**; org-999 rows unresolvable.
- **execute delegation (~8, shared-db):** each execute calls through to the real guarded action and returns its result; a forged cross-org resolvedParams → the underlying Forbidden (the trust-in-delegate lock); demo mode → the underlying action's demo message (NOT a second one); record_payment overpay at execute → the transactional guard's message even if the preview said ok; audit rows written by the DELEGATE (verb from the underlying action, not a new one).
- **Router (~10):** the 3 write phrasings route to the right write id with extracted params; imperative-verb vs bare-noun read/write disambiguation ("payments" → recent_activity; "record a payment" → record_payment); AI-router mock producing a write command JSON; unknown/garbage → help; the write ids pass the Object.hasOwn whitelist.
- **runCommand confirm-path (~7, shared-db):** a write question returns a `confirm` result with NOTHING mutated (table counts unchanged); a read question still returns its normal result; a write whose preview fails returns the ok:false message (no Confirm offered); demo mode: a write question STILL returns a preview (read-only) — the block happens at confirm.
- **confirmWriteCommand (~5, shared-db):** happy confirm mutates via the delegate + audits; demo-blocked (delegate's guard); unauthenticated; forged commandId (Object.hasOwn) → error; the resolvedParams never appear in a Sentry capture (mocked-Sentry marker test).
- **Palette (~5, jsdom):** a confirm result renders summary+details+warning+Confirm/Cancel; Confirm calls confirmWriteCommand with the exact commandId+resolvedParams from the result; Cancel discards (no call); simulated success note; error-in-card.

## 8. Decisions

- The AI never mutates — it routes + previews; the human's Confirm calls the existing guarded action. This is the whole security story.
- Delegation only: 35b adds NO new write path, NO new audit verbs (the delegates audit as they always do), NO migration.
- No preview→confirm signing — the guarded delegate is the boundary; a forged confirm can't exceed the user's own authority.
- Demo: previews work (read-only); confirms are blocked by the delegate's own guard, single source of the demo message.
- Confirm-or-cancel exactly what was previewed (no inline param editing v1); re-ask to change.
- Destructive/terminal writes (void) deliberately excluded from the first AI-write slice.
