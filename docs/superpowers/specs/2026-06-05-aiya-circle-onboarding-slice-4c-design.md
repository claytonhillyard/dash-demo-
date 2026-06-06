# AIYA Dashboard — Slice 4c: Circle Onboarding — Design

**Date:** 2026-06-05
**Status:** Approved (design); implementation plan pending
**Builds on:** slices #0/1/1a/1b-1/1b-3/2/demo/1c/3 (multi-tenant foundation: real `orgs` table, `getCurrentOrgId()` async seam, JWT `{user, orgId}`), #4 (Circles: `circles` + `circle_members` + `deals.visibility_circle_id` + `getCircleIdsForOrg` + `isOrgMemberOfCircle` + name-leak guard), #5 (Website Overview), #10 (Deal Reply Threads — `canSeeDeal` predicate + denormalized `*_org_label` convention), #11 (Polish + Observability — Sentry tags on action layer), #12 (Web Vitals), #14 (Lighthouse CI), #16 (Bidding — `runWithUser` + `ForbiddenError` + transaction discipline for atomic state changes). The slice 4c race sentinel `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` was armed in slice 4 §8.9 and explicitly anticipates this slice.

---

## 1. Overview & Goals

Slice 4 widened the Deal Room across circles but shipped **zero** management UX — circle memberships were seeded via SQL or the Netlify demo fixture, never created at runtime. Slice 4c closes that loop: an org owner can create a circle, invite another org by slug, and the invited org can accept or decline. Members can leave their own membership; circle owners can remove others. The result is **self-service circle management** — the smallest honest cut of mockup 2's "TradeNet Exchange" onboarding flow that still preserves every slice-3/4 tenancy invariant.

The cut is tight by design: **no email sending, no per-circle RBAC (members are all peers within a circle), no public directory, no circle deletion, no circle rename, no slug change, no user accounts**. Invitations are addressed by *org slug* (the only cross-org identifier we have without users), the accept URL carries an unguessable 128-bit token, and tokens expire in 7 days. The recipient discovers pending invites on their own `/circles` page (no inbox notification). Email is slice 4d's job.

**Goals:**

- New `circle_invitations` table (id, circle_id, from_org_id, to_org_slug, token UNIQUE, status, created_at, expires_at, responded_at). Partial unique index `(circle_id, to_org_slug) WHERE status = 'pending'` makes duplicate invites impossible at the DB level.
- Six server actions wrapped in `runWithUser` + Zod:
  - `createCircle(name, slug)` — caller becomes `ownerOrgId`; caller is auto-inserted into `circle_members`.
  - `inviteOrgToCircle(circleId, toOrgSlug)` — owner only; rejects on duplicate pending invite via unique index.
  - `acceptInvitation(token)` — verifies the session's org's slug matches `to_org_slug`, that `status === 'pending'`, and that `expires_at > now()`. Wraps `SELECT … FOR UPDATE` on the invitation, `INSERT … ON CONFLICT DO NOTHING` on `circle_members`, and `UPDATE … status='accepted'` in **one transaction**.
  - `declineInvitation(token)` — same lookup gate, but only flips status to `'declined'`.
  - `removeOrgFromCircle(circleId, orgId)` — owner only; idempotent `DELETE WHERE`. Cannot remove the owner.
  - `leaveCircle(circleId)` — member self-removal; idempotent. Cannot leave a circle the caller owns (owner must use a future "transfer ownership" flow — out of scope).
- New `/circles` admin RSC route — owner view (their circles + members + pending invites + invite form + create form) and member view (circles they belong to + per-row "Leave" button). Single page, role-conditional sections.
- Three new query helpers in `src/lib/circles/queries.ts`:
  - `getOwnedCirclesForOrg(db, orgId)` — circles where `ownerOrgId === orgId`.
  - `listCircleMemberOrgs(db, circleId, viewerOrgId)` — member org names + ids; double-checks the viewer is themselves a member before returning anything.
  - `getPendingInvitesIssuedByOrg(db, orgId)` and `getPendingInvitesForSlug(db, slug)` — owner's outbox and recipient's inbox.
- New `src/lib/circles/membership-mutations.ts` — this is the file the slice-4 race sentinel guards. It exports `addOrgToCircle` and `removeOrgFromCircle` as the **only** authorized membership writers. The sentinel test is repurposed (not deleted) to assert these helpers DO exist AND that they use transactions / `FOR UPDATE` locks for the check-then-write race.
- Demo seed: AIYA already owns "Trusted Partners" (id=201) with Mehta/Saint-Cloud/Marathi as members; add a pending invite from AIYA → fake org slug `argyle-mining` (org id 888 in fixture range) so the demo demonstrates the outbox UI. **No demo accept/decline flow** — all mutations short-circuit in demo mode.
- `/circles` is added to the middleware matcher and the Nav.
- Tests prove (TDD): (a) the membership-check → membership-insert race is closed by the transaction in `acceptInvitation`; (b) two concurrent accepts for the same token converge on exactly one membership row (or fail one with `Forbidden`); (c) tokens are unguessable and never appear in logs; (d) wire-supplied `fromOrgId` is ignored — stamped from session; (e) the cross-org slug check stops org C from redeeming org B's token; (f) expired invites are rejected without revealing why (single `Forbidden` for "expired" vs "not pending" vs "no such token"); (g) demo-mode disables every mutation; (h) the slice-3 cross-org isolation tests stay green.

**Non-Goals for Slice 4c** (each has a named home — see §13):

Email notifications (slice 4d "Circle Notifications"), per-circle RBAC (slice 4d, possibly 4d-2), per-org branding within circles, audit logging tables, public circle directory, circle deletion UI, circle rename / slug change, transfer ownership, multi-circle batch invites, slug autocomplete (privacy-preserving search needs a careful design — deferred), bulk member operations, "invited by" / "joined on" displays beyond the existing `created_at`, OAuth-style consent screens, magic-link login from an accept URL (requires the slice-3a Users feature), revoking individual not-yet-redeemed tokens (re-issuing is the workaround), invite reminders.

---

## 2. Data Model

### 2.1 New table: `circle_invitations`

```typescript
// src/db/schema.ts (append below `circleMembers`)
export const circleInvitations = pgTable(
  "circle_invitations",
  {
    id: serial("id").primaryKey(),
    circleId: integer("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    fromOrgId: integer("from_org_id")
      .notNull()
      .references(() => orgs.id),
    toOrgSlug: text("to_org_slug").notNull(),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "withdrawn", "expired"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    tokenUniq: unique("circle_invitations_token_uniq").on(t.token),
    // Partial unique index — only one *pending* invite for the same
    // (circle, to_org_slug) pair at a time. Accepted/declined/withdrawn
    // historical rows do not block a re-issue, which is the desired UX:
    // "we cancelled and want to re-invite" works without a manual cleanup.
    pendingUniq: uniqueIndex("circle_invitations_pending_uniq")
      .on(t.circleId, t.toOrgSlug)
      .where(sql`${t.status} = 'pending'`),
    // Hot path: the recipient's `/circles` page lists pending invites by slug.
    toSlugStatusIdx: index("circle_invitations_to_slug_status_idx")
      .on(t.toOrgSlug, t.status),
    // Hot path: the owner's `/circles` page lists invites they've issued.
    fromOrgStatusIdx: index("circle_invitations_from_org_status_idx")
      .on(t.fromOrgId, t.status),
  }),
);
```

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `circle_id` | integer NOT NULL → `circles.id` ON DELETE CASCADE | Deleting the circle (deferred to a future slice; no UI today) wipes its invites. |
| `from_org_id` | integer NOT NULL → `orgs.id` | Stamped from `session.orgId`; never accepted from the wire. |
| `to_org_slug` | text NOT NULL | The target org's slug from `orgs.slug`. We deliberately store the slug, not `to_org_id`, because the inviter may type a slug that does not yet exist as an org. The accept-time check resolves slug → org via `getCurrentOrgId() + orgs.slug`. |
| `token` | text NOT NULL UNIQUE | 128-bit `crypto.randomUUID()` (formatted UUID — 122 random bits, 6 fixed). Globally unique. Treated as a bearer secret on the accept URL; never logged. |
| `status` | text enum NOT NULL default `'pending'` | Transitions: `pending → accepted`, `pending → declined`, `pending → withdrawn`, `pending → expired`. Terminal states are immutable (no re-open). |
| `created_at` | timestamptz default now NOT NULL | |
| `expires_at` | timestamptz NOT NULL | `created_at + 7 days`, stamped server-side in the action. |
| `responded_at` | timestamptz NULL | Set to `now()` when status transitions out of `pending`. |

**Why `to_org_slug` instead of `to_org_id`?** The recipient org doesn't have a stable user-facing identifier other than its slug — and the slug is the only thing the inviter types into the UI. Storing the slug means:
- The invite can be issued before the recipient has a session (typing-driven UX).
- A future "rename org" feature would have to rewrite invites (cheap — small partial-index lookup), but we don't ship rename in this slice.
- Cross-org integrity at accept time becomes "session's org has slug `s` AND there exists a pending invite with `to_org_slug = s`" — both halves are server-resolved, neither half is wire-supplied.

The trade-off vs `to_org_id`: a fully numeric FK would be type-safe and cascade-on-delete, but the inviter can't know the target's id without a directory (which we're not building). The slug-based shape is the simplest honest cut.

**Why `crypto.randomUUID()` for the token?** Node 18+'s `crypto.randomUUID()` returns a v4 UUID with 122 bits of entropy from the OS CSPRNG (`/dev/urandom` on Linux, BCryptGenRandom on Windows). 122 bits is well above the 80-bit floor for an unguessable bearer secret. The token is also rate-limit-protected at the route level (slice 11's rate limiter is wired but slice 4c does **not** add explicit per-action rate limits — see §11.4). Brute force at the standard ~6-9 RPS observed prod ceiling would take >2^80 seconds on average; the token is operationally unguessable.

**Why the partial unique index on `(circle_id, to_org_slug) WHERE status = 'pending'`?** This is the load-bearing concurrency primitive for `inviteOrgToCircle`. Two simultaneous calls from the owner — say the user double-clicks "Invite" — would both pass an application-side "does a pending row exist?" check and then both insert. The partial unique index makes the second insert fail at the DB level with a unique-constraint violation, which the action layer translates to a generic `Forbidden` (the user's first click already succeeded; the second is a no-op). Historical rows in non-pending states do not occupy the index, so a re-invite after a decline is allowed.

**Why no `ON DELETE CASCADE` on `from_org_id`?** Consistent with slice 3's `orgs` policy — deleting an org is a future hardening question. Slice 4c does not need to make that call. Invitations from a deleted org would simply orphan their `from_org_id`, but the deletion path doesn't exist in this slice, so the question is academic.

### 2.2 New helpers in `src/lib/circles/queries.ts`

Three additions; the existing `getCircleIdsForOrg`, `getCirclesForOrg`, `getCircleNamesForOrg` stay verbatim.

```typescript
/** Owner perspective: circles where the caller's org is the owner. */
export async function getOwnedCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> { … }

/** Returns the member orgs of a circle, but ONLY if the caller is themselves
 *  a member of that circle. Defense in depth: the page already only iterates
 *  over circles the viewer is in, but this helper double-checks. */
export async function listCircleMemberOrgs(
  db: Db,
  circleId: number,
  viewerOrgId: number,
): Promise<{ orgId: number; name: string; slug: string; createdAt: Date }[]> { … }

/** Outbox for the owner: pending invites this org has issued. */
export async function getPendingInvitesIssuedByOrg(
  db: Db,
  orgId: number,
): Promise<InvitationRow[]> { … }

/** Inbox for the recipient: pending invites addressed to this org's slug. */
export async function getPendingInvitesForSlug(
  db: Db,
  slug: string,
): Promise<InvitationRow[]> { … }
```

All four helpers are demo-mode-aware via the same `if (isDemoMode()) return getSeed…` pattern slice 4 established.

### 2.3 New file: `src/lib/circles/membership-mutations.ts`

The file the slice-4 race sentinel was guarding against. It exports exactly two functions:

```typescript
/** Idempotent insert: a transaction with FOR UPDATE on the invitation row
 *  closes the check-then-insert race. Called only by `acceptInvitation`. */
export async function addOrgToCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> { … }

/** Idempotent delete. No race concern — DELETE WHERE is safe to repeat. */
export async function removeOrgFromCircle(
  db: Db,
  circleId: number,
  orgId: number,
): Promise<void> { … }
```

These are the canonical writers. **No other file** writes to `circle_members`. The enforcement grep in §11.5 confirms.

### 2.4 Migration (`drizzle/0010_*.sql`)

Generated by `npm run db:generate` after the schema edits. Expected contents:

1. `CREATE TABLE circle_invitations (…)` with the columns above.
2. `CREATE UNIQUE INDEX circle_invitations_token_uniq ON circle_invitations (token);`
3. `CREATE UNIQUE INDEX circle_invitations_pending_uniq ON circle_invitations (circle_id, to_org_slug) WHERE status = 'pending';`
4. `CREATE INDEX circle_invitations_to_slug_status_idx ON circle_invitations (to_org_slug, status);`
5. `CREATE INDEX circle_invitations_from_org_status_idx ON circle_invitations (from_org_id, status);`

**Schema-only header** (same convention as slice 4):

```sql
-- schema-only; no seed data in this migration.
-- circle_invitations starts empty in prod; the demo seed lives in
-- src/lib/demo/seed.ts and never touches the DB.
```

**PGlite partial-index compatibility:** verified in slice 4 (the `deals_visibility_circle_idx` partial index uses the same pattern). No fallback needed.

**Rollback:** `DROP TABLE circle_invitations;` — safe. Memberships and circles are untouched.

---

## 3. Visibility Model

| Viewer relationship to circle | What they see on `/circles` |
|---|---|
| Owner (`circles.owner_org_id === viewer.orgId`) | Full member list of their owned circle(s); pending invites they've issued (with target slug + age + a "Withdraw" button — *withdraw is in scope for the owner's outbox row, not a separate "revoke pending invite" UI*); a "Create circle" form; a per-circle "Invite by org slug" form. |
| Member, not owner (`(circle_id, viewer.orgId)` exists in `circle_members`) | Circles they belong to, with the member list (slice-4 invariant: only shown to members of that circle); a per-circle "Leave" button. |
| Invitee (pending invite exists with `to_org_slug === viewer's slug`) | A "Pending invitations" section listing each invite's circle name + inviting org's name + age + Accept / Decline buttons. |
| Neither | Empty `/circles` page with a helper paragraph: "You're not in any circles yet. When another org invites you, the invite will appear here." |

**Subtle invariant:** the owner sees the slugs they've invited (their own outbox). The recipient does not see *who else* has been invited to a circle they're a member of — only existing memberships are visible (slice-4 list semantics). A pending invitee sees only the circle name + the inviting org's name (resolved via `from_org_id → orgs.name`), not the other pending invitees.

**Why this matters:** the design preserves slice-4's "names only of circles you can see" rule. A pending invitee sees one circle's name (the one they're invited to) plus one org's name (the inviter); they do not see member lists or other invitations until they accept.

---

## 4. Authorization Rules

This is the load-bearing security section after §11. Six actions, each with a different gate:

### 4.1 `createCircle(name, slug)`

- **Caller:** any authenticated org.
- **Gate:** session is valid (handled by `runWithUser`). No further check — anyone can create a circle they own.
- **Side effect:** the caller's org is auto-inserted into `circle_members` as the first member. Owner is always a member; the UI distinguishes the owner via `circles.owner_org_id`, not by membership.

### 4.2 `inviteOrgToCircle(circleId, toOrgSlug)`

- **Caller:** the circle's `owner_org_id` only.
- **Gate:** `SELECT owner_org_id FROM circles WHERE id = $1 LIMIT 1`. If the row is missing OR `owner_org_id !== session.orgId`, throw `ForbiddenError`. This is the **first** rejection — before any slug lookup or insert.
- **Validation of `toOrgSlug`:**
  - Zod: `z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/)` — keeps invites to URL-safe slugs only.
  - Not validated against `orgs.slug` — see §4.7. The slug may be typed for an org that does not yet exist (e.g. a partner that hasn't registered).
- **Self-invite check:** if the slug resolves to the caller's own org, the action returns `{ ok: true }` as a no-op (the owner is already a member). This avoids a confusing "you cannot invite yourself" error message when the user pastes their own slug by mistake.
- **Duplicate-pending check:** purely DB-level via the partial unique index. Application code does NOT do a pre-insert SELECT. The `INSERT` is wrapped in a try/catch on the unique-violation error code; on conflict it returns `{ ok: false, error: "Forbidden" }` (we deliberately do not distinguish from other Forbidden cases — see §11.2 on rejection messaging uniformity).
- **Token generation:** `crypto.randomUUID()`, server-only.
- **`expires_at`:** `now() + INTERVAL '7 days'`, server-side.

### 4.3 `acceptInvitation(token)`

The load-bearing race resolution. **Wraps all of (a) token lookup, (b) status/expiry check, (c) slug cross-check, (d) `circle_members` insert, (e) `circle_invitations` status update in a single transaction.**

```typescript
return await db().transaction(async (tx) => {
  // 1) Read + lock the invitation row.
  const [inv] = await tx.execute(sql`
    SELECT id, circle_id, to_org_slug, status, expires_at
    FROM circle_invitations
    WHERE token = ${input.token}
    LIMIT 1
    FOR UPDATE
  `);
  if (!inv) throw new ForbiddenError();
  if (inv.status !== 'pending') throw new ForbiddenError();
  if (inv.expires_at <= new Date()) throw new ForbiddenError();
  // 2) Cross-org integrity: session's org slug MUST match the invite's target slug.
  const [meOrg] = await tx
    .select({ slug: orgs.slug })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!meOrg || meOrg.slug !== inv.to_org_slug) throw new ForbiddenError();
  // 3) Add membership (idempotent via ON CONFLICT DO NOTHING — the
  //    (circle_id, org_id) unique constraint from slice 4 covers it).
  await tx.execute(sql`
    INSERT INTO circle_members (circle_id, org_id)
    VALUES (${inv.circle_id}, ${orgId})
    ON CONFLICT (circle_id, org_id) DO NOTHING
  `);
  // 4) Mark invite accepted.
  await tx
    .update(circleInvitations)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(eq(circleInvitations.id, inv.id));
});
```

**The race resolution.** This is the answer to the slice-4 sentinel:
- **The check-then-write race** between "is the invite pending?" and "insert membership / update status" is closed by `FOR UPDATE` on the invitation row + the entire body running in one PG transaction. A second concurrent `acceptInvitation` for the same token will block on the lock; when it proceeds, the status read will return `'accepted'` and the call will `ForbiddenError`. Exactly one accept wins.
- **The check-then-insert race** on `circle_members` is closed by `ON CONFLICT DO NOTHING` against the slice-4 `circle_members_circle_org_uniq` unique constraint. Two simultaneous accepts can never produce two rows.
- **The check-then-state-update race** is closed by the same transaction holding the lock through the final `UPDATE`.

`removeOrgFromCircle` and `leaveCircle` are *idempotent deletes* — no race concern. `inviteOrgToCircle` is *protected by the partial unique index* — DB rejects duplicates.

### 4.4 `declineInvitation(token)`

- Same `FOR UPDATE` transaction as accept, but step 3 is omitted (no membership insert) and step 4 sets status to `'declined'`.
- The slug cross-check still runs: only the addressed org can decline. (Why: declining is an audit-relevant state transition; we don't let anyone with the token decline anyone else's invite.)

### 4.5 `removeOrgFromCircle(circleId, orgId)`

- **Caller:** the circle's `owner_org_id` only.
- **Gate:** `SELECT owner_org_id FROM circles WHERE id = $1`. Owner-only.
- **Special case:** **cannot remove the owner**. The action throws `ForbiddenError` if `orgId === circle.ownerOrgId`. The owner leaves by transferring ownership (out of scope) or by deleting the circle (out of scope).
- **Action body:** `DELETE FROM circle_members WHERE circle_id = $1 AND org_id = $2`. Idempotent — repeating the call deletes zero rows the second time, still returns `{ ok: true }`.
- **No transaction needed** — single statement, no consistency concern between rows.

### 4.6 `leaveCircle(circleId)`

- **Caller:** any session.
- **Gate:** the caller's `orgId` must be a member of the circle (else `ForbiddenError`). Owners cannot leave their own circle (else `ForbiddenError`).
- **Action body:** `DELETE FROM circle_members WHERE circle_id = $1 AND org_id = sessionOrgId`. Idempotent.
- **No transaction needed.**

### 4.7 Slug-based invite hardening

The recipient's slug check at accept time prevents three classes of attack:

1. **Token theft → unauthorized accept.** Org C steals B's invite token (e.g. from a shared accept URL). C tries `acceptInvitation(token)` from C's session. C's slug is `argyle-mining`; the invite's `to_org_slug` is `bgm-partners`. The action throws `Forbidden`.
2. **Slug squat.** Org D registers a slug that matches a pending invite to a not-yet-existing org. D logs in and accepts the invite intended for someone else. This is the same shape as (1) but framed as a registration attack — same defense. The remaining concern is "what if D legitimately registered the slug because it's their domain?" — that's outside the security boundary of this slice; we accept that the slug namespace is first-come-first-served (consistent with slice 3's slug-unique constraint).
3. **Forged session orgId.** Mitigated by slice 3's signed JWT — `orgId` comes from `requireSession()`, never the wire.

The first two are not theoretical: pasting an accept URL into Slack is exactly the threat model. The slug check is what makes the token + slug pair the actual credential, not the token alone.

---

## 5. Server Actions

All six actions live in a new file `src/lib/circles/actions.ts` (parallel to `src/lib/deals/actions.ts`). They use the slice-10/16 `runWithUser` + `ForbiddenError` pattern verbatim — slice 4c does **not** introduce a new wrapper.

### 5.1 Zod schemas — `src/lib/circles/validation.ts` (new)

```typescript
import { z } from "zod";

const SLUG_RE = /^[a-z0-9-]+$/;

export const createCircleInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(64).regex(SLUG_RE, "slug must be lowercase + digits + hyphens"),
});
export type CreateCircleInput = z.infer<typeof createCircleInput>;

export const inviteOrgToCircleInput = z.object({
  circleId: z.number().int().positive(),
  toOrgSlug: z.string().trim().min(1).max(64).regex(SLUG_RE, "slug must be lowercase + digits + hyphens"),
});
export type InviteOrgToCircleInput = z.infer<typeof inviteOrgToCircleInput>;

// Tokens are UUIDs; we accept the string shape and let the DB lookup decide.
// We do NOT use z.string().uuid() because future migrations may extend the
// token format (e.g. prefixed `inv_…`), and a Zod regex would couple validation
// to format choices that belong in the token generator.
export const tokenInput = z.object({
  token: z.string().trim().min(16).max(128),
});
export type TokenInput = z.infer<typeof tokenInput>;

export const removeOrgFromCircleInput = z.object({
  circleId: z.number().int().positive(),
  orgId: z.number().int().positive(),
});
export type RemoveOrgFromCircleInput = z.infer<typeof removeOrgFromCircleInput>;

export const leaveCircleInput = z.object({
  circleId: z.number().int().positive(),
});
export type LeaveCircleInput = z.infer<typeof leaveCircleInput>;
```

No schema accepts `fromOrgId`, `currentOrgId`, or any session field. Slice-3 invariant preserved.

### 5.2 Action signatures — `src/lib/circles/actions.ts` (new)

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb, type Db } from "@/db/client";
import { circles, circleMembers, circleInvitations, orgs } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  createCircleInput, inviteOrgToCircleInput, tokenInput,
  removeOrgFromCircleInput, leaveCircleInput,
  type CreateCircleInput, type InviteOrgToCircleInput, type TokenInput,
  type RemoveOrgFromCircleInput, type LeaveCircleInput,
} from "./validation";
import { firstZodError } from "@/lib/company/validation";

// Hoisted ForbiddenError so other slices' actions can share it via
// `src/lib/auth/errors.ts`. Slice 4c is the second consumer (slice 4 already
// has an inline one in deals/actions.ts); the implementation plan promotes
// both to the shared file.
import { ForbiddenError } from "@/lib/auth/errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(d: Db | null): Promise<void> { testDb = d; }
function db(): Db { return testDb ?? getDb(); }

async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let user: string;
  let orgId: number;
  try {
    const session = await requireSession();
    user = session.user;
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, user, orgId);
    revalidatePath("/circles");
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Forbidden" };
    console.error("[circles action] database error:", e);
    Sentry.captureException(e, { tags: { layer: "circles-action" } });
    return { ok: false, error: "Database error" };
  }
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(createCircleInput, raw, async (input, _user, orgId) => {
    const d = db();
    await d.transaction(async (tx) => {
      const [c] = await tx
        .insert(circles)
        .values({ name: input.name, slug: input.slug, ownerOrgId: orgId })
        .returning({ id: circles.id });
      await tx
        .insert(circleMembers)
        .values({ circleId: c.id, orgId });
    });
  });
}

export async function inviteOrgToCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(inviteOrgToCircleInput, raw, async (input, _user, orgId) => {
    const d = db();
    // Owner-only gate (BEFORE any other read or write).
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    // Self-invite no-op: if the slug resolves to the caller's own org, do nothing.
    const [me] = await d.select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (me && me.slug === input.toOrgSlug) return;
    // Generate token + expiry server-side; never accepted from wire.
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    try {
      await d.insert(circleInvitations).values({
        circleId: input.circleId,
        fromOrgId: orgId,
        toOrgSlug: input.toOrgSlug,
        token,
        expiresAt,
      });
    } catch (e) {
      // The partial unique index throws on duplicate-pending. Translate to
      // Forbidden — we don't tell the inviter "an invite already exists"
      // (avoids confirming the existence of a pending invite from another
      // owner; this is conservative but harmless UX).
      if (isUniqueViolation(e)) throw new ForbiddenError();
      throw e;
    }
  });
}

function isUniqueViolation(e: unknown): boolean {
  // PG SQLSTATE 23505 = unique_violation. Both pglite and Neon surface this
  // in the same `.code` field on the error object.
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

export async function acceptInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input, _user, orgId) => {
    const d = db();
    await d.transaction(async (tx) => {
      // 1) Lock the invitation row.
      const rows = await tx.execute(drizzleSql`
        SELECT id, circle_id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      // pglite returns { rows: [...] } from .execute() — Neon returns the array
      // directly. The .execute wrapper normalizes this in the codebase;
      // implementation plan handles the precise shape.
      const inv = (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0]
        ?? (rows as unknown as Array<Record<string, unknown>>)[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      // 2) Cross-org integrity.
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      // 3) Membership insert — idempotent.
      await tx.execute(drizzleSql`
        INSERT INTO circle_members (circle_id, org_id)
        VALUES (${inv.circle_id}, ${orgId})
        ON CONFLICT (circle_id, org_id) DO NOTHING
      `);
      // 4) Mark accepted.
      await tx
        .update(circleInvitations)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
    });
  });
}

export async function declineInvitation(raw: unknown): Promise<ActionResult> {
  return runWithUser(tokenInput, raw, async (input, _user, orgId) => {
    const d = db();
    await d.transaction(async (tx) => {
      const rows = await tx.execute(drizzleSql`
        SELECT id, to_org_slug, status, expires_at
        FROM circle_invitations
        WHERE token = ${input.token}
        LIMIT 1
        FOR UPDATE
      `);
      const inv = (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0]
        ?? (rows as unknown as Array<Record<string, unknown>>)[0];
      if (!inv) throw new ForbiddenError();
      if (inv.status !== "pending") throw new ForbiddenError();
      const expiresAt = inv.expires_at instanceof Date
        ? inv.expires_at
        : new Date(inv.expires_at as string);
      if (expiresAt <= new Date()) throw new ForbiddenError();
      const [me] = await tx.select({ slug: orgs.slug }).from(orgs)
        .where(eq(orgs.id, orgId)).limit(1);
      if (!me || me.slug !== inv.to_org_slug) throw new ForbiddenError();
      await tx
        .update(circleInvitations)
        .set({ status: "declined", respondedAt: new Date() })
        .where(eq(circleInvitations.id, inv.id as number));
    });
  });
}

export async function removeOrgFromCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(removeOrgFromCircleInput, raw, async (input, _user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c || c.ownerOrgId !== orgId) throw new ForbiddenError();
    if (input.orgId === c.ownerOrgId) throw new ForbiddenError(); // cannot remove the owner
    await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, input.orgId)));
  });
}

export async function leaveCircle(raw: unknown): Promise<ActionResult> {
  return runWithUser(leaveCircleInput, raw, async (input, _user, orgId) => {
    const d = db();
    const [c] = await d.select({ ownerOrgId: circles.ownerOrgId }).from(circles)
      .where(eq(circles.id, input.circleId)).limit(1);
    if (!c) throw new ForbiddenError();
    if (c.ownerOrgId === orgId) throw new ForbiddenError(); // owner cannot leave
    await d
      .delete(circleMembers)
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.orgId, orgId)));
  });
}
```

**Why pass `_user` into the callback but not use it?** Symmetry with slice-10/16 actions; future audit-log work uses the user label. Keeping the signature consistent now avoids a follow-up sweep.

**Why `revalidatePath("/circles", "/", "/deals")`?** The Deal Room panel and the /deals admin both read circle memberships; a circle change must invalidate them. `/circles` itself is the page we just mutated. The slice-4 panel uses `getCircleNamesForOrg`, which a new membership immediately changes.

### 5.3 `membership-mutations.ts` — repurposing the sentinel target

The slice-4 sentinel expects this file to be absent. Slice 4c creates it with the canonical writers:

```typescript
// src/lib/circles/membership-mutations.ts
//
// SLICE 4C: the file the slice-4 sentinel was guarding against.
// addOrgToCircle + removeOrgFromCircle live here so security-audit greps
// have a single answer to "who writes to circle_members?" — these two
// functions. The actions layer (createCircle, acceptInvitation,
// removeOrgFromCircle action, leaveCircle action) calls them.
//
// The race resolution is the FOR UPDATE lock + transaction in
// acceptInvitation (see src/lib/circles/actions.ts §5.2 and spec §4.3).
// This file is a thin pass-through to the membership UPSERT/DELETE so the
// sentinel grep `grep -rn "insert(circleMembers)" src/` resolves to one
// canonical writer.

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { circleMembers } from "@/db/schema";

export async function addOrgToCircle(db: Db, circleId: number, orgId: number): Promise<void> {
  // INSERT … ON CONFLICT DO NOTHING is idempotent under concurrent calls —
  // the slice-4 (circle_id, org_id) unique constraint is the gate.
  await db.execute(sql`
    INSERT INTO circle_members (circle_id, org_id)
    VALUES (${circleId}, ${orgId})
    ON CONFLICT (circle_id, org_id) DO NOTHING
  `);
}

export async function removeOrgFromCircle(db: Db, circleId: number, orgId: number): Promise<void> {
  await db
    .delete(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.orgId, orgId)));
}
```

The action layer at §5.2 calls these helpers (the `createCircle` and `acceptInvitation` actions still need their transactions, so the helper is inlined into the transaction body via `tx.execute(…)`; the standalone helper is called by `removeOrgFromCircle` and `leaveCircle` and by tests).

### 5.4 The repurposed sentinel — `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts`

The slice-4 sentinel asserted "no membership-mutation helpers exist." Slice 4c **flips both assertions** (does not delete the file) to assert the chosen resolution:

```typescript
describe("slice-4c race resolution sentinel — locks in the chosen mitigation", () => {
  it("membership-mutations module exists and exports addOrgToCircle + removeOrgFromCircle", async () => {
    const mod = await import("@/lib/circles/membership-mutations");
    expect(typeof mod.addOrgToCircle).toBe("function");
    expect(typeof mod.removeOrgFromCircle).toBe("function");
  });

  it("acceptInvitation closes the check-then-insert race with FOR UPDATE in a transaction", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      new URL("../../../src/lib/circles/actions.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/FOR\s+UPDATE/i);
    expect(src).toMatch(/\.transaction\s*\(/);
  });

  it("circle_members INSERT goes through ON CONFLICT DO NOTHING (idempotent under retries)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const rel of ["src/lib/circles/actions.ts", "src/lib/circles/membership-mutations.ts"]) {
      const src = await fs.readFile(
        path.resolve(process.cwd(), rel),
        "utf8",
      );
      // At least one ON CONFLICT clause must be present across these two
      // files. Both have one in practice; we don't pin which.
      // (We do the check across both so a future refactor can collapse them
      // without flipping this assertion's intent.)
      // The combined assertion is at the end of the loop.
    }
    const combined = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/actions.ts"),
      "utf8",
    ) + await fs.readFile(
      path.resolve(process.cwd(), "src/lib/circles/membership-mutations.ts"),
      "utf8",
    );
    expect(combined).toMatch(/ON\s+CONFLICT\s+\(circle_id,\s*org_id\)\s+DO\s+NOTHING/i);
  });
});
```

The repurposed sentinel is the load-bearing exit gate: if a future maintainer rips out the `FOR UPDATE` or the `ON CONFLICT` clause without consciously redesigning, this test fails and forces the same "choose a mitigation" conversation that slice 4's sentinel forced.

---

## 6. Query Layer

### 6.1 New helpers in `src/lib/circles/queries.ts`

```typescript
export interface InvitationRow {
  id: number;
  circleId: number;
  circleName: string;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

export async function getOwnedCirclesForOrg(db: Db, orgId: number): Promise<CircleRow[]> { … }

export async function listCircleMemberOrgs(
  db: Db,
  circleId: number,
  viewerOrgId: number,
): Promise<{ orgId: number; name: string; slug: string; createdAt: Date }[]> {
  // Demo-mode short-circuit: return seeded partners if the viewer is in this
  // circle in the seed graph.
  if (isDemoMode()) { … }
  // Defense-in-depth: even though the page only iterates over circles the
  // viewer is a member of, we re-check membership before returning anything.
  const isMember = await isOrgMemberOfCircle(db, viewerOrgId, circleId);
  if (!isMember) return [];
  const rows = await db
    .select({
      orgId: circleMembers.orgId,
      name: orgs.name,
      slug: orgs.slug,
      createdAt: circleMembers.createdAt,
    })
    .from(circleMembers)
    .innerJoin(orgs, eq(orgs.id, circleMembers.orgId))
    .where(eq(circleMembers.circleId, circleId))
    .orderBy(circleMembers.createdAt);
  return rows;
}

export async function getPendingInvitesIssuedByOrg(db: Db, orgId: number): Promise<InvitationRow[]> {
  // Joins circle_invitations + circles + orgs (the "from" org name) so the
  // owner's outbox renders without further round-trips.
  …
}

export async function getPendingInvitesForSlug(db: Db, slug: string): Promise<InvitationRow[]> {
  // Joins circle_invitations + circles + orgs (the "from" org name) so the
  // recipient's inbox renders the inviter org's display name without leaking
  // anything beyond what § 3 allows.
  …
}
```

**Why `InvitationRow.token` is exposed on the owner's outbox but NOT on the recipient's inbox row in the UI:** the owner already created the token (it's no leak to show it back to them — they would need it to debug). The recipient sees the token via the URL/Accept button only — never displayed as text. The data layer returns it in both cases for symmetry; the UI handles surfacing.

### 6.2 Demo seeds

Three new exports in `src/lib/demo/seed.ts`:

```typescript
/** The fake "Argyle Mining" org id used as an invite recipient in demo mode.
 *  Outside the slice-4 partner range (501-503) but still high enough to read
 *  as fixture-only. */
export const DEMO_ARGYLE_ORG_ID = 504;

export interface SeedInvitation {
  id: number;
  circleId: number;
  fromOrgId: number;
  fromOrgName: string;
  toOrgSlug: string;
  circleName: string;
  // Demo invites have a static `token` value for stable rendering, but the
  // UI never displays it — same as real invites.
  token: string;
  status: "pending";
  createdAt: Date;
  expiresAt: Date;
}

export function getSeedPendingInvitesForOrg(orgId: number): SeedInvitation[] {
  // Returns the demo pending invite from AIYA → argyle-mining IF the viewer
  // is AIYA (owner perspective). Returns an empty array for any other org.
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return [ /* one pending invite */ ];
}

export function getSeedOwnedCirclesForOrg(orgId: number): SeedCircle[] {
  // AIYA owns the Trusted Partners demo circle.
  if (orgId !== DEMO_AIYA_ORG_ID) return [];
  return getSeedCircles();
}
```

---

## 7. UI Layer

### 7.1 `/circles` admin route — `src/app/(admin)/circles/page.tsx` (new)

Single RSC; role-conditional sections. The page parallel-fetches everything in one `Promise.all`:

```tsx
export const dynamic = "force-dynamic";

export default async function CirclesPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [me] = await db.select({ slug: orgs.slug, name: orgs.name }).from(orgs)
    .where(eq(orgs.id, orgId)).limit(1);
  const [memberOf, owned, pendingInbox, pendingOutbox] = await Promise.all([
    getCirclesForOrg(db, orgId),
    getOwnedCirclesForOrg(db, orgId),
    getPendingInvitesForSlug(db, me?.slug ?? ""),
    getPendingInvitesIssuedByOrg(db, orgId),
  ]);
  const memberRows = await Promise.all(
    memberOf.map(async (c) => ({
      circle: c,
      isOwner: c.ownerOrgId === orgId,
      members: await listCircleMemberOrgs(db, c.id, orgId),
    })),
  );

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Circles</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      {/* Pending invitations (recipient's inbox) */}
      {pendingInbox.length > 0 && (
        <PendingInvitesInbox invitations={pendingInbox} />
      )}

      {/* Owned circles + invite forms */}
      <OwnedCirclesSection
        owned={owned}
        pendingOutbox={pendingOutbox}
      />

      {/* Member-of circles + leave button */}
      <MemberCirclesSection rows={memberRows} />

      {/* Create-new-circle form */}
      <CreateCircleForm />
    </main>
  );
}
```

### 7.2 Component breakdown

| Component | File | Responsibility |
|---|---|---|
| `PendingInvitesInbox` | `src/components/circles/PendingInvitesInbox.tsx` | Renders the recipient's pending invites with Accept / Decline buttons. The buttons are client-side forms that call `acceptInvitation` / `declineInvitation` with the token. |
| `OwnedCirclesSection` | `src/components/circles/OwnedCirclesSection.tsx` | For each owned circle: name + slug + member list (slugs as muted tags) + a `Remove` button per non-owner member; a per-circle `Invite by slug` form. Above the list, the pending-outbox section shows invites issued by the owner with their target slug + age + a `Withdraw` button (which calls a derived `withdrawInvitation` — see §13 deferral note; for slice 4c we DEFER the withdraw button and ship the outbox as read-only). |
| `MemberCirclesSection` | `src/components/circles/MemberCirclesSection.tsx` | For each circle the viewer belongs to but does NOT own: name + member list + `Leave` button. The owner's row appears in `OwnedCirclesSection` instead. |
| `CreateCircleForm` | `src/components/circles/CreateCircleForm.tsx` | Client form: name + slug inputs, submit calls `createCircle`. Slug field has live lowercase coercion + dash normalization. |
| `InviteOrgForm` | `src/components/circles/InviteOrgForm.tsx` | Client form embedded inside each owned circle's section. One input (slug), one button. Submitted via the action layer. |

**Withdraw clarification:** in §1 we mentioned the owner has a Withdraw button on their outbox row. After designing it, the withdraw flow needs (a) the seventh action `withdrawInvitation(token)` (or `withdrawInvitationByCircleSlug(circleId, toOrgSlug)`), (b) its own race resolution (same FOR UPDATE pattern), and (c) tests. To keep the slice tight, **withdraw is DEFERRED to slice 4c-1** (a follow-up patch) — slice 4c ships the outbox as read-only. The implementation plan does not include withdraw. (Listed in §13.)

**Server-action wire format:** following slice-2/16 convention, the client forms use `useTransition` + a button-disabled state. The accept/decline buttons inside `PendingInvitesInbox` are individually-rendered `<form action={acceptInvitation}>` blocks with a hidden `<input name="token">` — except since Next.js server actions don't deserialize hidden inputs into typed objects, slice 4c follows the slice-16 pattern of a client-side `onClick` that calls the action with `{ token }` directly.

### 7.3 Nav + middleware

- `src/components/dashboard/Nav.tsx`: add `"Circles": "/circles"` to `ROUTES`. Add `"Circles"` to `SECTIONS` between `"TradeNet Exchange"` and `"Market Intelligence"` (alphabetic order with the cluster of owner-facing routes).
- `src/middleware.ts`: add `"/circles"` to the matcher.

### 7.4 No dashboard panel this slice

Slice 4c is admin-route work; no `/` panel changes. The existing slice-4 DealRoomPanel subtitle ("Connected via …") becomes accurate the moment a user accepts an invite — that wiring already exists.

---

## 8. Demo Mode

### 8.1 Demo behavior matrix

| Surface | Demo behavior |
|---|---|
| `/circles` route | Renders. AIYA's perspective: owned-circles section shows "AIYA Trusted Partners" with its 3 partner members; outbox shows the pending demo invite to `argyle-mining`. Inbox is empty (AIYA has no pending received invites in the seed). |
| `createCircle`, `inviteOrgToCircle`, `acceptInvitation`, `declineInvitation`, `removeOrgFromCircle`, `leaveCircle` | All short-circuit at the top of `runWithUser` with `{ ok: false, error: "Demo mode — changes are disabled" }`. None of the membership-mutation, transaction, or token-generation code runs. |
| Forms on `/circles` | Render with all fields enabled; submit shows the demo-disabled toast. Same pattern as slice 2/10/16 forms. |
| Query helpers (`getOwnedCirclesForOrg`, `listCircleMemberOrgs`, `getPendingInvites…`) | Short-circuit on `isDemoMode()` to the seed. The Netlify demo never boots pglite. |

### 8.2 Demo seed extension

Three new exports + one new fake org constant. The fake org `argyle-mining` is **not** in the membership graph — it's only referenced via `to_org_slug` on the pending invite. This is honest to the slice 4c shape: the recipient hasn't accepted yet, so they don't appear as a circle member.

### 8.3 Demo notice on `/circles`

Reuse `<DemoNotice />` from `src/components/deals/DemoNotice.tsx`. The same banner that appears on `/deals` appears on `/circles` when `NEXT_PUBLIC_DEMO_MODE=true`.

---

## 9. Tests (TDD)

All test files follow the established pattern: `// @vitest-environment node`, `vi.mock("next/cache")`, `vi.mock("@/lib/auth/requireSession")`, and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` helpers.

### 9.1 `test/db/circle-invitations-migration.test.ts` (new)

- `circle_invitations` table starts empty.
- Unique constraint on `token` rejects duplicate tokens.
- Partial unique index on `(circle_id, to_org_slug) WHERE status = 'pending'` rejects a second pending invite for the same circle+slug but ALLOWS a re-invite after the first goes to `declined`.
- `ON DELETE CASCADE` on `circle_id`: deleting a circle cascades to its invites.
- FK rejects `from_org_id` that doesn't exist in `orgs`.

### 9.2 `test/lib/circles/queries.test.ts` (extended)

Existing tests stay verbatim. Append:

- `getOwnedCirclesForOrg` returns only circles where `ownerOrgId === orgId`.
- `listCircleMemberOrgs(db, c, viewer)` returns the joined `{orgId, name, slug, createdAt}` rows for members of `c` when `viewer` is a member.
- `listCircleMemberOrgs` returns `[]` when `viewer` is NOT a member of `c` (defense-in-depth guard).
- `getPendingInvitesIssuedByOrg(db, orgId)` returns the joined `InvitationRow[]` with `circleName` + `fromOrgName` populated.
- `getPendingInvitesForSlug(db, slug)` returns invites by `to_org_slug` and only those in `pending` status.

### 9.3 `test/lib/circles/validation.test.ts` (new)

For each Zod schema:
- Accepts the canonical happy-path shape.
- Rejects empty / missing required fields.
- Rejects slug not matching `/^[a-z0-9-]+$/` (uppercase, spaces, special chars).
- Rejects `circleId <= 0`.
- Strips wire-supplied `fromOrgId`, `currentOrgId`, `orgId` — confirms slice-3 invariant.

### 9.4 `test/lib/circles/createCircle.test.ts` (new)

- Caller becomes `ownerOrgId`; auto-inserted into `circle_members`.
- Slug collision rejects with the existing `circles_slug_uniq` constraint → `{ ok: false, error: "Database error" }` (we deliberately do not customize this to "Slug taken" — that's a UX polish for slice 4c-1).
- Demo mode disables.

### 9.5 `test/lib/circles/inviteOrgToCircle.test.ts` (new)

- Owner can invite a slug → row appears in `circle_invitations` with `token` + `expires_at` set.
- Non-owner attempts → `Forbidden`; zero rows written.
- Duplicate pending invite for same `(circle, slug)` → `Forbidden` (second insert fails at the partial unique index).
- After a decline, owner can re-invite → success (partial index allows non-pending rows to coexist).
- Self-invite (slug resolves to caller's own org) → `{ ok: true }`, no row written.
- Wire-supplied `fromOrgId` is stripped; row stamps from session.
- Demo mode disables.

### 9.6 `test/lib/circles/acceptInvitation.test.ts` (new) — the race resolution gate

- **Happy path:** owner invites slug S; org with slug S has session orgId X; `acceptInvitation(token)` from X succeeds; `circle_members` has `(circleId, X)`; invitation status is `accepted` with `responded_at` set.
- **Wrong slug:** owner invites slug S; org Y with slug ≠ S calls `acceptInvitation(token)` → `Forbidden`; no membership row; invite still `pending`.
- **Already accepted:** second `acceptInvitation` for the same token → `Forbidden` (status is now `'accepted'`, the lock + check rejects).
- **Expired:** seed an invite with `expires_at` in the past → `Forbidden`; no membership row; status stays `pending` (we deliberately do NOT flip to `'expired'` on accept attempt — that's a Vercel Cron job slice).
- **Nonexistent token:** `acceptInvitation('00000000-0000-0000-0000-000000000000')` → `Forbidden`.
- **Concurrent accepts (race resolution):** spawn two `acceptInvitation` promises with the same token in `Promise.all`. Assert exactly one returns `{ ok: true }` and the other returns `{ ok: false, error: "Forbidden" }`. Assert exactly one membership row exists. This is the load-bearing race test.
- Demo mode disables.

### 9.7 `test/lib/circles/declineInvitation.test.ts` (new)

- Happy path: addressed org declines → status `declined`, `responded_at` set, no membership row.
- Wrong-slug session declining → `Forbidden`.
- Already declined → `Forbidden`.
- Expired → `Forbidden`.

### 9.8 `test/lib/circles/removeOrgFromCircle.test.ts` (new)

- Owner removes a member → row gone.
- Non-owner attempts → `Forbidden`.
- Cannot remove owner → `Forbidden`.
- Idempotent: removing a non-member is `{ ok: true }` with zero deleted rows.
- Demo mode disables.

### 9.9 `test/lib/circles/leaveCircle.test.ts` (new)

- Member leaves → row gone.
- Owner attempts to leave their own circle → `Forbidden`.
- Non-member leaves (no row) → `{ ok: true }` (idempotent).
- Demo mode disables.

### 9.10 `test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` (modified — repurposed)

See §5.4. Old assertions FLIP: now asserts `membership-mutations.ts` DOES exist AND `actions.ts` contains `FOR UPDATE` + `.transaction(` + `ON CONFLICT (circle_id, org_id) DO NOTHING`.

### 9.11 `test/lib/demo/seed.test.ts` (extended)

- `getSeedPendingInvitesForOrg(DEMO_AIYA_ORG_ID)` returns exactly one pending invite with `to_org_slug = "argyle-mining"`.
- Other orgs see `[]`.
- The seeded invite's `expires_at` is in the future (so the demo UI shows it as pending).

### 9.12 `test/app/circles-page.test.tsx` (new) — RSC integration

- AIYA's perspective (mock `getCurrentOrgId` → 1): owned-circles section renders with "AIYA Trusted Partners" + 3 partner orgs; outbox shows the pending invite to `argyle-mining`; create-circle form renders.
- A non-AIYA fixture (orgId 888, no memberships): all sections render empty with the "You're not in any circles yet" helper text.

### 9.13 Token-handling tests — `test/lib/circles/token-security.test.ts` (new)

- `inviteOrgToCircle` generates a UUID-shaped token (matches the v4 regex).
- The action's `console.warn` and `console.error` paths do NOT include the token in any logged message — assert via spy on `console.warn`/`error` after a `Forbidden` rejection.
- Two consecutive invites produce different tokens (uniqueness via `crypto.randomUUID()`).

### 9.14 Existing tests stay green

The slice-3 cross-org isolation tests, the slice-4 `visibility.test.ts` (cross-circle truth table), the slice-10 `canSeeDeal` tests, and the slice-16 bid tests must pass without modification. Slice 4c is strictly additive — no read path widens further, no write path changes existing behavior.

The slice-4 `SLICE_4C_RACE_SENTINEL.test.ts` is the one exception — it's repurposed (not deleted) per §5.4 + §11.3.

---

## 10. Migration Plan

### 10.1 Order of operations

1. **Phase A (foundation):**
   1. Schema edit: add `circleInvitations` to `src/db/schema.ts`.
   2. Generate `drizzle/0010_*.sql` via `npm run db:generate`.
   3. Inspect + hand-prepend the `-- schema-only` header.
   4. Smoke test the migration (table + indexes exist; constraints + FKs work; partial unique index rejects duplicate pendings).
   5. Repurpose the slice-4 race sentinel (assertions flipped; file commented to reflect "slice 4c resolution locked in").
   6. Add three query helpers + their tests.
   7. Add demo seed for the pending AIYA → argyle-mining invite.

2. **Phase B (server actions):**
   1. Zod schemas + tests.
   2. `src/lib/circles/membership-mutations.ts` + its single unit test.
   3. `createCircle` + truth-table test.
   4. `inviteOrgToCircle` + truth-table test (includes the partial-unique race assertion).
   5. `acceptInvitation` + truth-table test **including the concurrent-accept race resolution**.
   6. `declineInvitation` + truth-table test.
   7. `removeOrgFromCircle` + truth-table test.
   8. `leaveCircle` + truth-table test.

3. **Phase C (UI):**
   1. `/circles` route (single RSC page).
   2. `PendingInvitesInbox`, `OwnedCirclesSection`, `MemberCirclesSection`, `CreateCircleForm`, `InviteOrgForm` components.
   3. Nav entry + middleware matcher.
   4. RSC integration test (`circles-page.test.tsx`).

4. **Phase D (verify + ship):**
   1. Enforcement greps (see §11.5).
   2. Full suite + tsc + build.
   3. Dev smoke (auth + demo).
   4. Whole-slice code review subagent.
   5. Merge to main.

### 10.2 Rollback

`DROP TABLE circle_invitations;` is sufficient. The slice-4 `circles` + `circle_members` tables are untouched. Demo seed changes are TS-only — re-deploy from `main` undoes them.

The repurposed sentinel test is the one piece of state that doesn't auto-revert; if slice 4c is reverted, the sentinel must be reverted in the same commit.

---

## 11. Security & Threat Model

### 11.1 The race resolution (THE load-bearing decision)

**Adopted: `FOR UPDATE` transaction + ON CONFLICT idempotent insert.**

`acceptInvitation` and `declineInvitation` wrap their read-check-write logic in a PG transaction with `SELECT … FOR UPDATE` on the invitation row. The lock is held until the transaction commits. The membership insert uses `ON CONFLICT (circle_id, org_id) DO NOTHING` against the slice-4 unique constraint.

`inviteOrgToCircle` uses the partial unique index `(circle_id, to_org_slug) WHERE status = 'pending'` to reject duplicate pending invites at the DB level — application code does NOT pre-SELECT.

`removeOrgFromCircle` and `leaveCircle` are idempotent deletes; no race.

The slice-4 race sentinel is **repurposed**, not deleted (§5.4). It now asserts the chosen resolution is in place.

### 11.2 Uniform `Forbidden` rejection

Every authz failure returns `{ ok: false, error: "Forbidden" }` — never a more specific message. This prevents an attacker from:

- Distinguishing "wrong slug" from "wrong token" (one is a slug enumeration, the other isn't).
- Distinguishing "expired" from "already accepted" (timing-based reasoning).
- Distinguishing "no such circle" from "you're not the owner" (org id enumeration).

The granular `console.warn` audit log lines DO include the reason for in-house debugging (slice-10/16 convention), but the wire response never does.

### 11.3 Token unguessability

`crypto.randomUUID()` (Node 18+) produces 122 bits of entropy from the OS CSPRNG. The token is the URL bearer secret on the accept link. With a 2^122 keyspace and even a 10,000 RPS adversary, an expected guess takes >2^88 seconds — comfortably above any practical threat. The 7-day TTL bounds the window further.

**Token-handling discipline:**
- Generated server-side via `crypto.randomUUID()` (never `Math.random()`).
- Stored in `circle_invitations.token` (one row, one token; never reused).
- Never logged: §9.13 tests assert `console.warn` / `console.error` never contain the token string.
- Accepted from the wire only in `acceptInvitation` and `declineInvitation`; transported in the request body via the server action.
- Not displayed in the UI to the recipient (the Accept button uses it programmatically). The owner sees the token in their outbox row for debugging only.

### 11.4 Rate limiting

Slice 4c does **not** add explicit per-action rate limits. The reasoning:
- `acceptInvitation` / `declineInvitation` are token-gated — the 122-bit token is the rate limit (you need the token to even attempt). Brute force is infeasible.
- `inviteOrgToCircle` is owner-gated — only an authenticated owner can call it. Spam-inviting hostile slugs is a UX nuisance the owner inflicts on themselves, not a security event.
- `createCircle` / `leaveCircle` / `removeOrgFromCircle` are session-gated — a malicious authenticated user is already inside the trust boundary.

If slice 4d (email integration) lands, a per-IP rate limit on `acceptInvitation` becomes important to prevent brute-force token-guessing via leaked URLs. Tracked as a slice-4d open item.

### 11.5 PR review enforcement greps (slice 4c exit gate)

Before merge:

- `grep -rn "insert(circleMembers)\|INSERT INTO circle_members" src/` → matches only in `src/lib/circles/actions.ts` (`createCircle`'s direct insert and `acceptInvitation`'s `tx.execute` block) and `src/lib/circles/membership-mutations.ts` (`addOrgToCircle`). No other writer.
- `grep -rn "from_org_id\|fromOrgId" src/lib/circles/validation.ts` → ZERO matches. The Zod schemas never accept `fromOrgId` from the wire.
- `grep -rn "currentOrgId\|orgId" src/lib/circles/validation.ts` → matches only inside the `removeOrgFromCircleInput` schema's `orgId: z.number().int().positive()` (the *target* org id of the remove action — that's a wire field, but it's authorized against `session.orgId !== input.orgId` indirectly via the owner-only check). Document this exception inline.
- `grep -rn "FOR UPDATE" src/lib/circles/` → matches in `src/lib/circles/actions.ts` (acceptInvitation + declineInvitation). The repurposed sentinel re-asserts this.
- `grep -rn "ON CONFLICT" src/lib/circles/` → matches in `actions.ts` + `membership-mutations.ts`.
- `grep -rn "console\." src/lib/circles/` → any `console.warn` / `console.error` line does NOT include `token` or `${input.token}` or `${inv.token}`.
- `grep -rn "owner_org_id\|ownerOrgId" src/lib/circles/` → matches in `queries.ts` (`CircleRow` projection) AND in `actions.ts` (the owner-only gate in `inviteOrgToCircle` + `removeOrgFromCircle`). This is the **first** slice where `ownerOrgId` is used for authorization — that's expected and documented.

### 11.6 Cross-org integrity at accept time

§4.3 / §4.7 describe the slug-cross-check. The test at §9.6 (wrong-slug accept) is the asserting test.

The remaining slug-namespace concerns are out of scope: slug squatting is a problem of org registration (slice 3) not invite acceptance, and is bounded by `orgs.slug` being unique (slice-3 invariant).

### 11.7 Demo-mode safety

`runWithUser` short-circuits in demo before any action runs. The query layer short-circuits on `isDemoMode()` to seeds. No code path writes to the DB in demo. No tokens are generated in demo (the seeded `token` is a literal string from the seed file, never produced by `crypto.randomUUID()`).

### 11.8 Audit logging — explicit gap

Same as slice 4 + 10 + 16: only `console.warn` / `console.error` lines, no audit table. Slice 3 §10 "tenancy audit logs" remains the named home for this work. Slice 4c does **not** widen the audit-log scope.

### 11.9 JWT integrity

Unchanged from slice 3. The action layer reads `orgId` from the signed JWT via `requireSession()`. Any client manipulation of the cookie either passes signature verification (legitimate session) or gets rejected by `verifySession`.

---

## 12. File Plan

### New files

| Path | Purpose |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/actions.ts` | Six server actions (`createCircle`, `inviteOrgToCircle`, `acceptInvitation`, `declineInvitation`, `removeOrgFromCircle`, `leaveCircle`) + the local `runWithUser` + `ForbiddenError` import |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/validation.ts` | Zod schemas (5 of them) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/membership-mutations.ts` | `addOrgToCircle` + `removeOrgFromCircle` — canonical writers, sentinel target |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/auth/errors.ts` | `ForbiddenError` class (promoted from inline in `deals/actions.ts`) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/app/(admin)/circles/page.tsx` | `/circles` RSC route |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/circles/PendingInvitesInbox.tsx` | Recipient inbox section |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/circles/OwnedCirclesSection.tsx` | Owner section |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/circles/MemberCirclesSection.tsx` | Member section |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/circles/CreateCircleForm.tsx` | Create-circle client form |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/circles/InviteOrgForm.tsx` | Per-circle invite client form |
| `/Users/claytonhillyard/Downloads/dashboard project /root/drizzle/0010_*.sql` | Generated migration (schema-only) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/db/circle-invitations-migration.test.ts` | Migration smoke test |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/validation.test.ts` | Zod schema tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/createCircle.test.ts` | createCircle truth table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/inviteOrgToCircle.test.ts` | invite truth table + partial-unique race |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/acceptInvitation.test.ts` | accept truth table + **concurrent-accept race** |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/declineInvitation.test.ts` | decline truth table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/removeOrgFromCircle.test.ts` | removeOrgFromCircle truth table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/leaveCircle.test.ts` | leaveCircle truth table |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/token-security.test.ts` | UUID shape + no-token-in-logs assertions |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/app/circles-page.test.tsx` | RSC integration test for `/circles` |

### Modified files

| Path | Change |
|---|---|
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/db/schema.ts` | Add `circleInvitations` pgTable |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/circles/queries.ts` | Add `getOwnedCirclesForOrg`, `listCircleMemberOrgs`, `getPendingInvitesIssuedByOrg`, `getPendingInvitesForSlug`, `InvitationRow` interface |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/demo/seed.ts` | Add `DEMO_ARGYLE_ORG_ID`, `getSeedPendingInvitesForOrg`, `getSeedOwnedCirclesForOrg`, `SeedInvitation` interface; extend exports |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/lib/deals/actions.ts` | Replace inline `ForbiddenError` class with `import { ForbiddenError } from "@/lib/auth/errors"` (no behavioral change) |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/components/dashboard/Nav.tsx` | Add `Circles: "/circles"` to `ROUTES` + `"Circles"` to `SECTIONS` |
| `/Users/claytonhillyard/Downloads/dashboard project /root/src/middleware.ts` | Add `"/circles"` to matcher |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/SLICE_4C_RACE_SENTINEL.test.ts` | **Repurposed** — assertions flipped to lock in the chosen race resolution |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/circles/queries.test.ts` | Extend with new helper tests |
| `/Users/claytonhillyard/Downloads/dashboard project /root/test/lib/demo/seed.test.ts` | Extend with `getSeedPendingInvitesForOrg` + `getSeedOwnedCirclesForOrg` assertions |

### Removed files

None.

---

## 13. Out of Scope (Explicit)

| Feature | Assigned to |
|---|---|
| Email notifications for invites (Resend / Postmark) | Slice 4d "Circle Notifications" |
| Per-circle RBAC (read-only vs read-write members; admin role) | Slice 4d "Circle Roles" |
| Public circle directory / discovery | Slice 4e (not yet sized) |
| Circle deletion UI | Slice 4c-1 follow-up or slice 4d, depending on RBAC interaction |
| Circle rename / slug change | Slice 4c-1 follow-up |
| `withdrawInvitation(token)` action (owner's outbox withdraw button) | Slice 4c-1 follow-up — needs its own FOR UPDATE design + tests; deliberately deferred to keep slice 4c tight |
| Users table integration (invites by user email instead of org slug) | Depends on slice 3a Users |
| Audit logging of invitation mutations (DB table) | Slice 3 §10 "tenancy audit logs" |
| Transfer-ownership of a circle | Slice 4d |
| Invite reminders / re-send notifications | Slice 4d |
| Invite expiration sweep (Vercel Cron) — flip pending → expired after TTL | Cron + scheduled-jobs slice |
| Multi-circle batch invites | Future polish |
| Slug autocomplete in the invite form (privacy-preserving) | Future — needs careful design (don't leak org existence via timing) |
| OAuth-style consent screens for the recipient | Slice 4d/e |
| Magic-link login from an accept URL (unauthenticated accept) | Depends on slice 3a Users |
| `/circles/[slug]` deep-link routes | Slice 4d |
| `circles.owner_org_id` enabling **deletion** authority | Slice 4c-1 follow-up |
| Per-org branding within circles (logo, theme) | Slice 4d or Branding slice (TBD) |
| Rate limit per action | Slice 4d (email arrival) is the first time this becomes load-bearing |
| Real-time invitation feed (WebSocket) | Future "Live" slice |
| Bulk member operations (remove N at once) | Future polish |
| Org-name resolution for non-existent target slugs | Out — the inviter sees only their own slug; the recipient sees the inviter's name (resolved via `from_org_id`) |

---
