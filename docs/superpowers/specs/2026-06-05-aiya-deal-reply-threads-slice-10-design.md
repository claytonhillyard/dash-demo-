# AIYA Dashboard — Slice 10: Deal Reply Threads — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0 (foundation), #1 (live market), #1a (AIYA dashboard), #1b-1 (inventory), #1b-3 (diamond price lists), #1c (customizable layout), demo (Netlify simulation mode), slice 2 (Deal Room), slice 3 (Multi-Tenant Foundation), and slice 4 (Circles: `circles` + `circle_members` + `deals.visibility_circle_id`, widened deals reads, `ForbiddenError` + `runWithUser` authz pattern, denormalized `postedByLabel` for cross-org identity display, `formatDealVisibility` name-leak guard) — all shipped on `main`.

**Numbering note:** Slice numbers 5-9 are reserved for the parallel-agent track (slice 5 "Website Overview" is spec'd; slices 6-9 are open). This deal-reply work picks up at slice 10 to avoid range collisions. Functionally it is the direct sequel to slice 4 (Circles).

---

## 1. Overview & Goals

Turn the Deal Room from a one-way broadcast into an actual market. Today an org can post a BUY/SELL deal — optionally scoped to a Circle — but viewers can't engage. There is no "still available?", no counter-offer, no DM. **Reply threads are the missing primitive that lets buyers and sellers talk.**

The thread system supports two visibility modes per deal:

- **Private (default)** — each interested partner has a 1-to-1 thread with the deal owner. Competing partners cannot see each other's interest, prices, or counter-offers. This is the B2B-trade-marketplace default and the right choice for jewelry where competing buyers should not tip each other off.
- **Group chat (optional)** — all messages are visible to every org that can see the parent deal. Mental model = Slack thread.

The deal owner picks the default mode when posting (radio in `PostDealForm`) and can switch the default anytime. The critical design choice: **the `thread_mode` setting applies to FUTURE replies only.** Each `deal_messages` row records the mode it was sent under (per-message snapshot); switching the default never retroactively rewrites who can see existing messages. Users cannot "unsay things in a group chat," and they cannot retroactively expose private DMs by flipping a switch.

Each deal in the panel shows an unread-reply badge ("🔴 3 new") based on a tiny `deal_thread_reads (org_id, deal_id, last_read_at)` table. Without this signal, partners would have to manually re-open every deal to check for replies — the panel would feel dead.

All authz reuses slice-4's `ForbiddenError` + `runWithUser` callback pattern. All cross-org identity display reuses the denormalized `from_org_label` snapshot pattern that mirrors `deals.postedByLabel`. No new auth primitive is introduced.

**Goals:**

- New `deal_messages` table with the fields and indexes specified in §3, plus a `deal_thread_reads` table for unread tracking.
- New `deals.thread_mode` column (enum `"private" | "group"`, default `"private"`).
- Four server actions, all wrapped in `runWithUser` + Zod + `revalidatePath`: `postDealMessage`, `setDealThreadMode`, `deleteDealMessage`, `markDealThreadRead`.
- Three query functions in `src/db/dealMessages.ts`, each taking explicit `orgId` (slice-3 invariant — no defaults): `getDealMessages`, `getUnreadCountsForOrg`, `getDealThreadModeForOwner`.
- `DealRoomPanel` extended with per-row chevron, unread badge, and inline `DealThreadAccordion` component.
- `PostDealForm` extended with thread-mode radio (Private / Group) shown only when a circle is selected (mode is moot for owner-only deals).
- Demo seed: 2 seeded threads on existing AIYA deals (one private, one group) so the live demo shows the feature working.
- Cross-circle visibility truth-table test, authz truth-table test, mode-switch race test, soft-delete window test, unread-badge math test.

## 2. Non-Goals (each has a named home)

- **Edits to messages** — adds version history complexity without obvious need. Defer to slice 10-polish or later.
- **Attachments (photos/PDFs) on messages** — file uploads land in slice 12 (deal photos on the deal row itself). Attachments on individual messages are a downstream follow-up.
- **Email/push notifications when someone replies** — covered by slice 15 (Watchlists + Resend).
- **@-mentions / typing indicators / per-message read receipts** — not on roadmap; unread badge per-deal is sufficient signal.
- **Markdown or rich-text rendering** — plain text only. Sidesteps the entire XSS surface that the security-defaults guidance flags. HTML sanitization libraries are unnecessary because we never accept or render any HTML.
- **Bidding / structured price offers** — covered by slice 11 (Bidding tab). Reply threads are freeform conversation; bids are structured, lifecycle-bearing offers. Different subsystems.

## 3. Schema

### 3.1 `deal_messages` (new)

```ts
deal_messages
  id               serial PK
  deal_id          int    NOT NULL  FK → deals(id) ON DELETE CASCADE
  from_org_id      int    NOT NULL  FK → orgs(id)
  from_org_label   text   NOT NULL   -- denormalized snapshot of the sender's org name at send time
  body             text   NOT NULL   -- plain text only, ≤ 2000 chars (enforced in Zod)
  thread_mode      enum   NOT NULL   -- "private" | "group", recorded at send time, immutable
  deleted_at       timestamptz NULL  -- soft-delete tombstone; rendered as "{label} deleted a message"
  created_at       timestamptz NOT NULL DEFAULT now()
```

Indexes:
- `(deal_id, created_at DESC)` — thread render (the hot read path)
- `(from_org_id, created_at DESC)` — supports future "my replies" view; cheap, defensible
- A `(deal_id, from_org_id, thread_mode)` index is **speculative** for the private-thread visibility filter. Decision is deferred to the plan stage: run `EXPLAIN` on the §7.1 query against pglite with realistic row counts; add only if the planner prefers it over the `(deal_id, created_at)` + filter combo. Indexes are cheap to add later; over-indexing now would just slow down writes.

### 3.2 `deal_thread_reads` (new)

```ts
deal_thread_reads
  org_id           int    NOT NULL  FK → orgs(id)
  deal_id          int    NOT NULL  FK → deals(id) ON DELETE CASCADE
  last_read_at     timestamptz NOT NULL
  PRIMARY KEY (org_id, deal_id)
```

The composite PK is the natural upsert key — `markDealThreadRead` uses `ON CONFLICT (org_id, deal_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`.

Index `(org_id, last_read_at DESC)` is implied by the PK for the panel batch-fetch path.

### 3.3 `deals` (alter)

```ts
+ thread_mode      enum NOT NULL DEFAULT "private"   -- owner's current default for NEW replies
```

Migration generates as `drizzle/0006_deal_reply_threads.sql`. All existing deals get `"private"` as the default. The hand-edited block at the top of 0001 (and the equivalent at the top of 0005) is **not** edited — slice 10 only adds, never alters seed rows in earlier migrations.

## 4. Visibility model — the subtle part

`deals.thread_mode` is the **current default the owner has set**. `deal_messages.thread_mode` is the **mode that was active when this specific message was sent** and is **immutable** for the life of the row.

Switching `deals.thread_mode` via `setDealThreadMode`:
- Updates only the `deals` row's column.
- Does **not** touch `deal_messages.thread_mode` for any existing row.
- New messages posted after the switch use the new mode.
- The UI shows a banner inside the thread accordion: *"Mode switched to Group Chat at {ts}. Earlier private replies remain private to their participants."* (and the symmetric message for the other direction).

**Private message visibility:** the row is visible to exactly two orgs — the deal owner's org AND the `from_org_id`. No other org sees the row, even if they can see the parent deal.

**Group message visibility:** the row is visible to every org that can see the parent deal — i.e., `deal.org_id` plus, if `deal.visibility_circle_id IS NOT NULL`, all `circle_members(circle_id = visibility_circle_id).org_id` (the existing slice-4 visibility set).

**Render contract from the owner's viewpoint:**
- *Group messages* render as one merged chronological thread.
- *Private messages* render as separate per-replier accordions — each titled by the replier's `from_org_label`.

**Render contract from a non-owner's viewpoint:**
- *Group messages* on this deal are visible (interleaved chronologically with any of their own group messages).
- *Their own private thread* with the owner is visible. Other partners' private threads are not.

## 5. Authz rules (all server-enforced via `runWithUser`)

1. **Post a reply (`postDealMessage`)** — caller's org must be allowed to see the parent deal. Reuses the slice-4 visibility predicate verbatim: owner, or member of `deal.visibility_circle_id`.
2. **Read a private thread message** — only the deal owner and the message's `from_org_id` can see it. Enforced inside `getDealMessages` via SQL `WHERE` clause, not application-layer filtering.
3. **Read a group thread message** — anyone who satisfies rule 1 can see it.
4. **Switch `deals.thread_mode` (`setDealThreadMode`)** — caller must be the deal owner.
5. **Soft-delete a message (`deleteDealMessage`)** — caller must be the message's `from_org_id` AND `now() - created_at < 15 minutes`. (No edit; only delete.)
6. **Mark thread read (`markDealThreadRead`)** — caller must be allowed to see the parent deal (rule 1).

Violations throw `ForbiddenError` inside the `runWithUser` callback. The callback's `catch` converts it to `{ ok: false, error: "Forbidden" }` with zero DB writes — exactly the slice-4 pattern. **No** explicit `try/catch` is added in the action body; the existing wrapper handles it.

## 6. Server actions

All in `src/lib/deals/actions.ts` next to `postDeal`. All wrapped via `runWithUser` (the slice-3/4 helper that resolves the session, runs Zod, calls the callback, revalidates `/`, and maps errors).

### 6.1 `postDealMessage(rawInput): Promise<ActionResult>`

```ts
input = z.object({
  dealId: z.number().int().positive(),
  body:   z.string().trim().min(1).max(2000),
})
```

Steps inside the callback:
1. Look up `(deal.id, deal.org_id, deal.visibility_circle_id, deal.thread_mode)`.
2. Assert visibility (rule 1) — throw `ForbiddenError` if the caller's org can't see this deal.
3. Resolve caller's `org_label` (denormalize from the session's org row — same query helper slice 4 uses for `postDeal`).
4. Insert `deal_messages` with `thread_mode = deal.thread_mode` snapshot.
5. Done. Wrapper revalidates.

### 6.2 `setDealThreadMode(rawInput): Promise<ActionResult>`

```ts
input = z.object({
  dealId: z.number().int().positive(),
  mode:   z.enum(["private", "group"]),
})
```

1. Assert caller's `orgId` equals `deal.org_id` — else `ForbiddenError`.
2. `UPDATE deals SET thread_mode = $mode WHERE id = $dealId`.

### 6.3 `deleteDealMessage(rawInput): Promise<ActionResult>`

```ts
input = z.object({
  messageId: z.number().int().positive(),
})
```

1. Look up message: `(from_org_id, created_at, deleted_at)`.
2. Assert `from_org_id === caller.orgId` — else `ForbiddenError`.
3. Assert `now() - created_at < interval '15 minutes'` — else `ForbiddenError`.
4. Assert `deleted_at IS NULL` (idempotent — double-delete is a no-op).
5. `UPDATE deal_messages SET deleted_at = now() WHERE id = $messageId`.

### 6.4 `markDealThreadRead(rawInput): Promise<ActionResult>`

```ts
input = z.object({
  dealId: z.number().int().positive(),
})
```

1. Assert visibility (rule 1).
2. Upsert `deal_thread_reads`:
   ```sql
   INSERT INTO deal_thread_reads (org_id, deal_id, last_read_at)
   VALUES ($orgId, $dealId, now())
   ON CONFLICT (org_id, deal_id) DO UPDATE SET last_read_at = now()
   ```

## 7. Query layer (`src/db/dealMessages.ts`)

All functions take an explicit `viewerOrgId: number` — no defaults, matching the slice-3 invariant. All are demo-mode-aware (short-circuit to empty / zero when `isDemoMode()` is true, mirroring slice-4 query helpers).

### 7.1 `getDealMessages(db, viewerOrgId, dealId): Promise<DealMessageView[]>`

Returns messages ordered ascending by `created_at`. The result type:

```ts
type DealMessageView = {
  id: number;
  dealId: number;
  fromOrgId: number;
  fromOrgLabel: string;
  body: string | null;          // null when deleted_at IS NOT NULL — caller renders tombstone
  threadMode: "private" | "group";
  isDeleted: boolean;
  createdAt: Date;
};
```

SQL filter (high-confidence sketch, refined during plan stage):

```sql
SELECT m.id, m.deal_id, m.from_org_id, m.from_org_label,
       CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END AS body,
       m.thread_mode,
       (m.deleted_at IS NOT NULL) AS is_deleted,
       m.created_at
FROM deal_messages m
JOIN deals d ON d.id = m.deal_id
WHERE m.deal_id = $dealId
  AND (
    -- caller can see the parent deal at all?
    d.org_id = $viewerOrgId
    OR (
      d.visibility_circle_id IS NOT NULL
      AND d.visibility_circle_id IN (
        SELECT circle_id FROM circle_members WHERE org_id = $viewerOrgId
      )
    )
  )
  AND (
    -- and may they see THIS particular message?
    m.thread_mode = 'group'
    OR m.from_org_id = $viewerOrgId
    OR d.org_id = $viewerOrgId   -- deal owner sees every private thread
  )
ORDER BY m.created_at ASC
```

The outer visibility predicate is the slice-4 widened OR; the inner is the new slice-10 per-message rule. Both as SQL — never application-layer filtering.

### 7.2 `getUnreadCountsForOrg(db, viewerOrgId, dealIds): Promise<Map<number, number>>`

Bulk batch query returning unread message count per deal. "Unread" = visible-to-viewer + `created_at > coalesce(last_read_at, '-infinity')` + `from_org_id != viewerOrgId` (your own messages never count as unread) + `deleted_at IS NULL`.

The Deal Room panel calls this once with all visible deal IDs — single round-trip.

### 7.3 `getDealThreadModeForOwner(db, viewerOrgId, dealId): Promise<"private" | "group" | null>`

Returns the current `deals.thread_mode` if the caller is the owner, else `null`. Used by the panel to decide whether to render the mode-selector UI.

## 8. UI

### 8.1 `PostDealForm` — thread-mode radio

Add a single radio pair: **Threads: ( ) Private — replies are 1-to-1 with you (default) | ( ) Group — replies are visible to everyone in this circle**.

Visible **only when** a circle is selected in the visibility dropdown. For owner-only deals, the mode is moot (only the owner can ever see messages), so we skip the radio and store `thread_mode = "private"` by default.

### 8.2 `DealRoomPanel` — per-row affordances

Each rendered deal row gets:
- A chevron button (▾ / ▸) on the right edge — toggles the inline thread accordion.
- An unread badge — `🔴 N new` if `getUnreadCountsForOrg` returns `N > 0` for this deal; `💬 N` (subtle) if there are any messages but no unread; nothing if there are zero messages. (Saves a render slot in the dense panel layout when threads are empty — the common case for fresh deals.)

### 8.3 `DealThreadAccordion` — new component

Props: `{ deal: DealView, viewerOrgId: number, isOwner: boolean, currentMode: "private" | "group" | null }`.

States rendered:
- **Empty thread** — placeholder text + Reply textarea.
- **Group thread** — chronological list of group messages, each row: `{from_org_label}  ·  {relative time}\n{body}`. Below: textarea + Send.
- **Private thread (viewer = non-owner)** — only the viewer's own thread with the owner.
- **Private thread (viewer = owner)** — list of per-replier sub-accordions, each labeled with the replier's org name and showing that one private thread. Empty state: "No private replies yet."
- **Mixed (mode was switched at least once on this deal)** — same per-mode render rules apply: group-mode messages on this deal show in the main chronological list; private-mode messages show in the viewer's private-thread sub-accordion(s). A "Mode switched to {mode} at {ts}" banner is rendered at the chronological point where two adjacent messages differ in `thread_mode`. The banner is purely informational — it does not gate visibility.

The mode banner is computed client-side from the message list: detect the transition point where `thread_mode` flips on adjacent messages and render the banner between them. No new DB column needed.

Mode selector (owner only): a small `Mode: [Private ▾]` dropdown at the top of the accordion. Changing it fires `setDealThreadMode`. Tooltip: *"This only affects new replies. Earlier messages stay where they were sent."*

Soft-delete: tombstone rows render as italic muted text: *"{label} deleted a message · {relative time}"*. The Reply input has a per-message kebab menu (`⋯ Delete`) on the author's own messages only when within the 15-min window.

### 8.4 Plain-text rendering contract

Message bodies render as React text children only:

```tsx
<p className="whitespace-pre-wrap text-sm">{message.body}</p>
```

React escapes the string content automatically. The repo's `eslint-plugin-react/no-danger` rule (already on) prevents any future authoring of HTML-injection from these bodies. The XSS surface is zero because we never enter the surface — this is the secure-by-default approach the security guidance prescribes (preferring "logic-less" rendering over HTML sanitization). HTML sanitization libraries (e.g. DOMPurify) are intentionally NOT added; they are unnecessary when the contract is "no HTML is ever constructed from message data."

### 8.5 Read-state side effect

Opening the accordion (`onClick` toggle handler) fires `markDealThreadRead(dealId)` once per open. The badge clears optimistically; the server action updates `deal_thread_reads`. No spinner — the action is fire-and-forget from the UX perspective.

## 9. Demo seed

The existing slice-2/4 seed (`src/lib/demo/seed.ts`) has AIYA's 5 deals as private-only and partner orgs (Mehta, Saint Cloud, Marathi) posting INTO the AIYA Trusted Partners circle. To showcase reply threads from AIYA's POV, slice 10 adds **two new AIYA-owned deals scoped to the circle** (IDs 109 and 110), each carrying a seeded thread:

1. **Deal 109 — AIYA SELL, scoped to AIYA Trusted Partners, `thread_mode = "private"`** — private thread between AIYA and Mehta:
   - Mehta (org `DEMO_PARTNER_ORG_IDS.MEHTA`) → "Still available? Can do $12,100 today, cash on pickup."
   - AIYA (org `DEMO_AIYA_ORG_ID`) → "Yes, available. Can meet $12,250 today. Photos already match what's posted."

2. **Deal 110 — AIYA SELL, scoped to AIYA Trusted Partners, `thread_mode = "group"`** — group thread visible to AIYA + all partner orgs in the circle:
   - Mehta → "Interested. Where are you shipping from?"
   - Saint Cloud → "Same question. Lead time?"
   - AIYA → "Ships from Bandra. Same-day pickup or 2-day courier. Both partners welcome."

That's **5 seeded messages total** (2 private + 3 group), spread across 2 new deals. The seed is idempotent: it checks for existing rows in `deal_messages` and short-circuits on subsequent runs.

Updates to `test/lib/demo/seed.test.ts`:
- Assert `deal_messages` count is exactly 5 after first seed.
- Assert `deals` count increases by 2 (109 + 110) — total goes from 8 → 10.
- Assert idempotency: second seed call does not add rows to either table.
- Assert deal 109 has `thread_mode = "private"` and deal 110 has `thread_mode = "group"` (so the demo correctly showcases both modes side-by-side).

## 10. Testing strategy (mirrors slice-4 file structure)

All under `test/lib/deals/` and `test/components/deals/` to keep the deals subsystem self-contained.

### 10.1 `test/lib/deals/reply-thread-visibility.test.ts` (cross-circle truth table)

Matrix dimensions: `{owner, in-circle partner, out-of-circle partner}` × `{owns the message, doesn't own the message}` × `{private mode, group mode}`. 12 combinations. Asserts every cell against `getDealMessages` return value (count, not contents).

### 10.2 `test/lib/deals/reply-thread-authz.test.ts` (write-side gate)

Matrix dimensions: `{owner, in-circle partner, out-of-circle partner}` × actions `{postDealMessage, setDealThreadMode, deleteDealMessage, markDealThreadRead}`. Cells return either `{ok:true}` or `{ok:false, error:"Forbidden"}` with zero DB writes confirmed via row-count delta.

### 10.3 `test/lib/deals/reply-thread-mode-switch.test.ts` (race / immutability)

- Post a private message
- Switch mode to group
- Post another message (lands as group)
- Switch mode back to private
- Post a third message (lands as private)
- Assert all three rows have the `thread_mode` they were sent under (mode-switching never rewrites prior rows)
- Render-time banner test: `DealThreadAccordion` shows banners at both transition points

### 10.4 `test/lib/deals/reply-thread-soft-delete.test.ts`

- Post → delete within 14 min → `{ok: true}`, `deleted_at` set
- Post → simulate 16 min later → `deleteDealMessage` returns `{ok: false, error: "Forbidden"}`
- Author A → tries to delete author B's message → `{ok: false, error: "Forbidden"}`
- Idempotent double-delete → `{ok: true}` no-op (per §6.3 step 4)

### 10.5 `test/lib/deals/reply-thread-unread.test.ts`

- Org A sends 3 messages on Deal-X to Org B
- Before any read: `getUnreadCountsForOrg(B, [X])` returns `Map{X => 3}`
- `markDealThreadRead({dealId: X})` from B
- After read: returns `Map{X => 0}`
- Org B sends a message of their own → still `Map{X => 0}` (own messages never count)
- Org A sends another → `Map{X => 1}`

### 10.6 `test/components/deals/DealThreadAccordion.test.tsx`

- Renders empty state with placeholder + textarea
- Renders group thread in chronological order with sender labels
- Renders private thread (viewer = non-owner) showing only viewer's thread
- Renders private thread (viewer = owner) showing per-replier sub-accordions
- Mode banner appears between messages where `thread_mode` flips
- Send-button click invokes `postDealMessage` with trimmed body
- Soft-delete tombstone renders italic muted, body is null
- Plain-text XSS sanity: body `"<script>x</script>"` renders as visible text, not executed

### 10.7 `test/components/deals/DealRoomPanel.unread-badge.test.tsx`

- Deal with 0 messages → no badge
- Deal with messages but all read → `💬 N` subtle badge
- Deal with N unread → `🔴 N new` prominent badge
- Click chevron → opens accordion → `markDealThreadRead` fires → badge updates to subtle

### 10.8 `test/db/dealMessages.test.ts` (query-layer unit tests)

- `getDealMessages` returns ascending by `created_at`
- `getDealMessages` returns `body: null, isDeleted: true` for soft-deleted rows
- `getDealMessages` excludes messages on deals the viewer can't see at all
- `getUnreadCountsForOrg` excludes own messages and deleted messages from the count
- `getDealThreadModeForOwner` returns `null` for non-owners

## 11. Migration & rollout

- `drizzle/0006_deal_reply_threads.sql` is generated, hand-edited only for index ordering (see slice-4 0005 precedent). The migration is additive — no destructive alters to existing tables aside from the `deals.thread_mode` column addition with a non-null default of `"private"`, which is safe for the existing row set.
- `outputFileTracingIncludes` already covers `./drizzle/**/*` — no Netlify config change needed.
- Demo-seed insertion runs after migration on every cold pglite boot. Existing slice-2/4 seed structure is untouched aside from the appended block.
- No env vars are added. No external services are touched.

## 12. Out-of-scope follow-ups (named, not built)

- **Slice 10-polish**: edit-within-window, @mentions, typing indicators, per-message read receipts.
- **Slice 11**: bidding tab with structured price/quantity offers, accept/reject lifecycle that auto-fills the deal, "Today's Bids" cross-deal panel.
- **Slice 12**: photo + cert attachments on the deal row itself (Vercel Blob).
- **Slice 13**: AI image-to-listing on PostDealForm.
- **Slice 14**: activity feed panel (audit log of all writes).
- **Slice 15**: Resend-backed email when someone replies on a deal you own — directly unblocks "partners get pinged between sessions" and stacks neatly on top of this slice.

---

## Design summary table

| Concern | Choice |
|---|---|
| Visibility model | Private-per-partner default; group as owner-toggleable opt-in |
| Mode switching | Per-message snapshot at send time; switch affects FUTURE replies only |
| Format | Plain text only, ≤ 2000 chars, no HTML/markdown rendering |
| Edit | Not allowed |
| Delete | Soft-delete, author-only, ≤ 15-min window, tombstone preserved |
| Unread state | `deal_thread_reads(org_id, deal_id, last_read_at)`; panel shows `🔴 N new` badge |
| Authz | Reuses slice-4 `ForbiddenError` + `runWithUser`; no new auth primitive |
| Identity display | Denormalized `from_org_label` (slice-4 pattern) |
| UI location | Inline accordion under each deal row; no new routes/modals |
| Security posture | Secure-by-default: never accept HTML, never render HTML; HTML sanitization libraries not used because attack surface is never opened |
