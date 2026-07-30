# iDesign Command Center — Slice 37: AI Email Drafting + Personality Memory — Design

**Date:** 2026-07-22
**Status:** Approved; implementation plan pending
**Builds on:** slice 32 (AI seam — feature `"drafting"` pre-whitelisted), slice 25 (sendEmail seam), slice 22 (customers), slices 27/29 (balance context), slice 24 (audit), slice 36 (the prompt-PII precedent: display name + aggregates, never contact details).

---

## 1. Overview & Goals

From a customer's edit page: pick an intent, generate a grounded draft (subject + body), edit it, send it through the slice-25 seam — or copy it. "Personality memory" v1 = an org-level voice (tone + signature) plus a per-customer style note ("prefers concise, no small talk" — the roadmap's Mehta example), both fed into the prompt. Keyless/demo → deterministic simulated drafts, same honesty pattern as slices 32/41.

**Goals:**
- Migration `0023`: `drafting_prefs` (org-level voice) + `customers.style_note` (per-customer memory) — both additive.
- `src/lib/drafting/` — context builder (structurally PII-limited), prompt + defensive parser, deterministic simulated draft, `draftEmail` + `sendDraft` + `saveDraftingPrefs` + `saveCustomerStyleNote` actions.
- `EMAIL_FEATURES` += `"drafting"`.
- `DraftEmailPanel` on the customer edit page (generate → edit → send/copy) + a voice-prefs section.
- ~45 tests.

## 2. Non-goals (named homes)

Voice-to-text (the roadmap's phone-tab idea — future slice). Learned/automatic style inference from past threads (v2; v1 is explicit notes). HTML email bodies (plain text — slice-28 decision). Scheduling/sequences. Draft history storage (drafts are ephemeral until sent; the audit row records the send).

## 3. Schema — migration `0023` (additive)

```ts
// drafting_prefs — one row per org (the org's outgoing voice).
export const draftingPrefs = pgTable("drafting_prefs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id), // plain no-action FK
  tone: text("tone"),          // e.g. "warm but concise; plain language; no exclamation marks"
  signature: text("signature"),// appended verbatim to sent bodies, e.g. "— Clayton, AIYA Designs"
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("drafting_prefs_org_unique").on(t.orgId)]);

// customers += style_note text NULL — per-customer personality memory.
```

## 4. Context builder — `src/lib/drafting/context.ts`

```ts
export type DraftingContext = {
  customerName: string;
  businessName: string | null;
  styleNote: string | null;          // the per-customer memory
  hasEmail: boolean;                 // gate for the Send button — the ADDRESS itself is NOT here
  healthBand: "healthy" | "watch" | "at_risk" | null;   // latest snapshot, null if none
  outstandingBalanceCents: number;   // issued invoices minus payments (slice-29 math)
  lastInvoice: { number: string; totalCents: number; status: string; issueDate: string | null } | null;
  lastPaymentDate: string | null;    // most recent payments.received_date
  recentActivity: string[];          // last 5 audit summaries for this customer (house rule: summaries never contain emails)
};
export async function buildDraftingContext(db, orgId, customerId): Promise<DraftingContext | null>; // null = not found/cross-org
```

Structural PII rule (slice-36/41 precedent): the customer's display name and business aggregates go to the AI — their EMAIL ADDRESS never does (`hasEmail` boolean only; the address is looked up again, org-scoped, at send time). The no-@ test locks the serialized prompt.

## 5. Prompt, parse, simulate — `src/lib/drafting/generate.ts` (pure parts) 

- `DRAFT_INTENTS = ["follow_up", "payment_reminder", "thank_you"] as const` + optional free-text `instruction` (≤300 chars, Zod).
- `buildDraftPrompt(ctx, prefs, intent, instruction?)` → `{system, prompt}`. System: assistant drafting a plain-text email FROM the org TO the named customer; obey tone; per-customer style note verbatim; NO subject-line clickbait; output EXACTLY: `SUBJECT: <one line>` then a blank line then `BODY:` then the body; do not invent facts beyond the provided context.
- `parseDraft(text)` → `{subject, body}` defensively: find `SUBJECT:` line (first match, trim, cap 200); body = everything after `BODY:` (trim). Missing SUBJECT → fallback `"Following up"` / intent-derived; missing BODY marker → whole remaining text as body; empty body → parse failure (caller maps to error, the slice-41 N3 lesson).
- `simulatedDraft(ctx, intent, prefs)` — deterministic, intent-specific template using the numbers (balance, last invoice) + tone hint + signature; same shape the parser returns.
- `generateEmailDraft` core (non-action, unit-testable): calls `generateAiText({feature: "drafting", tier: "fast", user: org tag, maxOutputTokens: 700})`; simulated → `simulatedDraft` (seam text ignored — 41 precedent); real → `parseDraft`; parse failure or empty → `{ok:false, error: "Couldn't generate a draft — try again"}`; seam errors mapped like 41.

## 6. Actions — `src/lib/drafting/actions.ts` ("use server", the run() scaffold copied per house pattern, FriendlyError included)

- **`draftEmail({customerId, intent, instruction?})`** — the ONE deliberate deviation: this action SKIPS the demo guard (documented in a comment: generation is read-only, and in demo the seam is simulated anyway — blocking it would kill the demo experience; slice-36's insight renders in demo for the same reason). Session + org-scoping still mandatory. Loads context (null → Forbidden), prefs, generates. Returns `{ok:true, subject, body, simulated} | {ok:false, error}`. NO audit (nothing happened yet), NO revalidate.
- **`sendDraft({customerId, subject, body})`** — fully guarded (demo guard ON). Zod: subject 1..200 trimmed, body 1..5000. Org-scoped customer load; no email → FriendlyError "No email on file for this customer". Body sent = body + (prefs.signature ? `\n\n${signature}` : "") — signature applied at SEND so the editable textarea shows what the user wrote. `sendEmail({to, subject, text, feature: "drafting"})`; simulated → `{ok:true, simulated:true}` (nothing stamped — nothing exists to stamp); real → ok. Audit on success (both real+simulated): verb `"sent"`, entityType `"customer"`, entityId, summary `Sent email to ${name}` (subject NOT in the summary — it's free text), payload `{simulated}`. Revalidate the customer edit path.
- **`saveDraftingPrefs({tone?, signature?})`** — demo-guarded; upsert on org unique (onConflictDoUpdate); Zod tone ≤500, signature ≤200; audit verb "updated", entityType "org", summary "Updated email drafting preferences", payload {} (never the text).
- **`saveCustomerStyleNote({customerId, styleNote})`** — demo-guarded; org-scoped update on customers; Zod ≤300 (empty string → NULL); audit verb "updated", entityType "customer", summary `Updated style note for ${name}`, payload {}.
- `EMAIL_FEATURES` += `"drafting"` (types.ts).

## 7. UI — `src/components/customers/DraftEmailPanel.tsx` (client; conventions from SendInvoicePanel/PaymentsPanel: useTransition, alert, refresh)

Props: `{ customerId, customerName, hasEmail, styleNote, prefsTone, prefsSignature }` (server page loads prefs + passes primitives).
- **Compose row:** intent select (3 intents, labeled), optional instruction input, Generate button (pending state).
- **Draft area** (after a successful generate): subject input + body textarea (both editable), a muted "Simulated draft — set AI_GATEWAY_API_KEY for live drafting" note when simulated, Copy button (navigator.clipboard, "Copied" flash), Send button — disabled with a tooltip-ish note when `!hasEmail`; on send ok → success line (+ simulated variant "Simulated — set RESEND_API_KEY for live sends"), router.refresh.
- **Voice section** (collapsible, matches house disclosure patterns): org tone + signature inputs + Save; customer style note textarea + Save. Both via their actions with pending/alert.
- Wire into the customer edit page near the slice-36 insight card (read that page for placement + what's already fetched; add prefs + styleNote to the page's data loads, org-scoped).

## 8. Test plan (~45)

- **Migration smoke (+3):** drafting_prefs table + unique(org_id); customers.style_note nullable.
- **Context (~8, shared-db):** shape for a full customer (balance math matches slice-29 derivation; last invoice picked by latest issueDate then id; lastPaymentDate max); no-email customer → hasEmail false; no-snapshots → healthBand null; recentActivity capped 5 latest; cross-org → null; **structural: serialize the context of a customer whose email is seeded — JSON.stringify contains no "@"**.
- **Generate (~12):** prompt includes name/tone/style note/instruction/balance dollars; no "@" ever; SUBJECT/BODY format demanded; parseDraft table (well-formed; missing SUBJECT → fallback; missing BODY marker; extra whitespace; multi-line subject takes first line; empty → failure); simulatedDraft deterministic + intent-varying + signature-free (signature applies at send); generateEmailDraft: simulated substitution (seam text ignored), real parse path, empty-after-parse → error, every seam code mapped.
- **Actions (~14, shared-db):** draftEmail works IN DEMO (stubbed env → ok+simulated — the deviation locked by test) but still Forbidden cross-org + Unauthorized without session; sendDraft demo-BLOCKED; no-email friendly; real send calls seam with the org-scoped address + signature appended once; simulated no-send-record + flag; audit rows (verbs/entities/summaries, JSON.stringify no "@"); saveDraftingPrefs upsert twice → one row updated; saveCustomerStyleNote org-scoped + empty→NULL; Zod caps.
- **Panel (~8, jsdom):** generate populates editable fields; edited body is what sendDraft receives; send disabled without email; simulated notes both stages; copy calls clipboard (mock); prefs + style-note saves fire actions; error alerts.
- **Page (+2, demo RSC):** panel renders on the customer edit page with seed customer 2204 (has email) — assert the intent select present; style note passed through.

## 9. Decisions

- `draftEmail` skips the demo guard (read-only + simulated-in-demo; documented + test-locked). Everything that writes or sends stays guarded.
- Email addresses never enter prompts or context types — looked up org-scoped at send time only (structural, slice-36/41 lineage).
- Signature applied at send, not in the editable draft (WYSIWYG for the body the user controls; signature is org config).
- Subject never appears in audit summaries (free text); names do (house rule).
- Per-customer memory is an explicit note v1 — no inference, no per-customer tone learning yet.
