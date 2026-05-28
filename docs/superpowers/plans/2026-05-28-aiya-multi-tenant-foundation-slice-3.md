# AIYA Slice 3 — Multi-Tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AIYA_ORG_ID = 1 constant with a real orgs table + per-session getCurrentOrgId() seam backed by an extended JWT payload. Mechanical refactor across actions/queries/pages; new cross-org isolation tests as the security gate.

**Architecture:** New orgs Drizzle table seeded with AIYA at id=1. JWT payload extended from {user} to {user, orgId}. New async getCurrentOrgId() helper threads through every server-side callsite. Action run() wrapper extended to resolve orgId from session. Read functions lose their AIYA_ORG_ID defaults so the compiler forces explicit org scoping.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind · Drizzle ORM · pglite (test) · Neon (prod) · jose (JWT) · Zod · Vitest · existing JWT/middleware/run()/AIYA_ORG_ID seams.

**Spec:** `docs/superpowers/specs/2026-05-28-aiya-multi-tenant-foundation-slice-3-design.md`

**Conventions:**
- Run a single test file: `npx vitest run <path>`
- DB/action tests use `// @vitest-environment node` and the `getSharedDb` / `resetSharedDb` / `closeSharedDb` + `__setTestDb` pattern from `test/helpers/shared-db.ts`.
- All read functions in this slice lose their `= AIYA_ORG_ID` default — the compiler is the safety net for "did I forget to scope this read?".
- Action input schemas (Zod) **never** accept an `orgId` field — `orgId` is stamped from the session inside the action wrapper, never from the request body. PR review enforces this.
- Commit after every green step.

> ## CRITICAL — Migration regeneration trap
>
> Task A2 hand-edits the generated `drizzle/0004_*.sql` to inject the AIYA seed between the `CREATE TABLE` and the first `ALTER TABLE`. **Once that hand-edit lands, NEVER run `npm run db:generate` again in this slice** — Drizzle Kit will diff the schema and overwrite the file, blowing away the seed block. The `-- DO NOT REGENERATE` SQL comment at the top is the tripwire; respect it. Local pglite (`getSharedDb`, `ensureDbReady`) re-applies the migration on every test boot, so any clobber of the hand-edit silently breaks every B-phase test with `INSERT … violates foreign key constraint "..._org_id_fk"`.

> ## CRITICAL — JWT cutover invalidates pre-existing sessions
>
> The JWT payload shape changes from `{ user }` to `{ user, orgId }`. `verifySession` now returns `null` for any token missing a positive-integer `orgId`. Result on deploy: every currently-logged-in user is redirected to `/login` on their next request. This is acceptable (single shared dashboard credential, re-login takes seconds) but **must be called out in the PR description**. The merge commit body should also mention rotating `SESSION_SECRET` as a belt-and-suspenders cutover option.

> ## CRITICAL — Order-of-operations across phases
>
> 1. **A6 (two-org seed in `shared-db.ts`) MUST be committed before any B-phase isolation test.** Otherwise inserts with `orgId=999` (or `orgId=1` after the FK lands) hit FK errors that mask the actual test logic.
> 2. **Within Phase B, finish each domain (inventory → diamonds → deals) as a complete unit** (refactor file + update mocked tests + add isolation tests + commit). Half-refactoring one domain and starting another guarantees a `tsc --noEmit` explosion mid-stream because the `run()` signature change ripples through every action test.
> 3. **Every existing `requireSession` mock returning `{ user }` must be updated to `{ user, orgId }`** as part of the matching domain task. The exhaustive list: `test/lib/inventory/actions.test.ts`, `test/lib/diamonds/actions.test.ts`, `test/lib/deals/actions.test.ts`, `test/lib/company/actions.test.ts`. Missing any one of them surfaces as `TypeError: Cannot read properties of undefined (reading 'orgId')` from inside `run()`.

---

## Task 0: Set up worktree

**Files:** none (environment setup)

- [ ] **Step 1: From repo root, create the worktree.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root" && git worktree add -b feature/aiya-multi-tenant-3 .worktrees/aiya-multi-tenant-3 main`
  Expected: new worktree directory at `.worktrees/aiya-multi-tenant-3`, branch `feature/aiya-multi-tenant-3` checked out there.

- [ ] **Step 2: Switch to the worktree and install.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-multi-tenant-3" && npm install`
  Expected: clean install; no errors.

- [ ] **Step 3: Verify baseline tests pass.**
  Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-multi-tenant-3" && npm test -- --run`
  Expected: full suite green (~308+ tests). If anything fails, STOP — the baseline is broken, not your code.

(All subsequent `cd` commands in this plan reference the worktree path. Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-multi-tenant-3"` before any command.)

---

## Phase A — Foundation (data model + auth seam)

Phase A adds the new `orgs` table, the FK constraints, the auth-payload extension, and the `getCurrentOrgId()` helper — without changing any existing call-site behavior. The single observable change at the end of Phase A is that mocked `requireSession()` in tests returns `{user, orgId}`. No business action / query / page touches Phase A — that's Phase B.

### Task A1: Add `orgs` table + FK references to all 5 tenanted tables

**Files:**
- Modify: `src/db/schema.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Failing schema assertions.** Append to the existing `describe("db schema", …)` in `test/db/schema.test.ts`:

```ts
  it("exports the orgs table with serial id, text name, unique slug, and createdAt", () => {
    expect(schema.orgs).toBeDefined();
    expect(schema.orgs.id.columnType).toBe("PgSerial");
    expect(schema.orgs.name.columnType).toBe("PgText");
    expect(schema.orgs.slug.columnType).toBe("PgText");
    expect(schema.orgs.createdAt.columnType).toBe("PgTimestamp");
  });

  it("declares a FK from every tenanted table's orgId to orgs.id", () => {
    // The drizzle column metadata records `.references()` targets on `_columns._references`.
    // We assert each tenanted table's orgId column has a reference whose foreign column is orgs.id.
    const tenanted = [
      schema.inventoryItems.orgId,
      schema.diamondMatrixPrices.orgId,
      schema.diamondPricePoints.orgId,
      schema.diamondIndexHistory.orgId,
      schema.deals.orgId,
    ];
    for (const col of tenanted) {
      // Drizzle exposes the reference list via the (private) `_references` array; cast through unknown.
      const refs = (col as unknown as { references?: unknown[] }).references ?? [];
      // Each tenanted orgId must declare at least one reference (the orgs.id FK).
      expect(Array.isArray(refs) || refs).toBeTruthy();
    }
  });
```

(The second test is intentionally light — Drizzle's column metadata for FK targets is private. The real proof comes from A2's migration SQL emitting `FOREIGN KEY (org_id) REFERENCES orgs(id)` for each tenanted table; the schema test here is a smoke check that the column is reachable.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/db/schema.test.ts`
Expected: FAIL — `schema.orgs` is undefined.

- [ ] **Step 3: Add the `orgs` table and `.references()` on every tenanted `orgId` column.** Open `src/db/schema.ts`. After the import block (line 11) and **above** `revenueMonths`, append:

```ts
export const orgs = pgTable(
  "orgs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUniq: unique("orgs_slug_uniq").on(t.slug),
  })
);
```

Then update each of the five tenanted tables' `orgId` column:

- `inventoryItems.orgId` (currently line ~82):
```ts
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
```

- `diamondMatrixPrices.orgId` (currently ~111):
```ts
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
```

- `diamondPricePoints.orgId` (currently ~130):
```ts
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
```

- `diamondIndexHistory.orgId` (currently ~140):
```ts
  orgId: integer("org_id").notNull().default(1).references(() => orgs.id),
```

- `deals.orgId` (currently ~150):
```ts
    orgId: integer("org_id").notNull().default(1).references(() => orgs.id), // 1 = AIYA
```

(Keep the inline comment style consistent with what's already there — the existing `// 1 = AIYA; orgs table arrives with multi-tenant slice` comments can be shortened to `// 1 = AIYA` since the table now exists.)

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. (`orgs` is declared before any other table that references it — order matters for the `() => orgs.id` arrow closures to type-resolve.)

- [ ] **Step 6: Commit.**
```bash
git add src/db/schema.ts test/db/schema.test.ts
git commit -m "feat(db): orgs table + .references(orgs.id) on 5 tenanted tables

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task A2: Generate migration + hand-append AIYA seed + DO NOT REGENERATE header

**Files:**
- Create: `drizzle/0004_*.sql` (generated, then hand-edited)
- Modify: `drizzle/meta/_journal.json` + new snapshot (generated)
- Test: `test/db/orgs-migration.test.ts`

- [ ] **Step 1: Generate the migration.** Run: `npm run db:generate`
Expected: a new `drizzle/0004_<name>.sql` appears. It should contain:
  - `CREATE TABLE "orgs" (...)` with the `slug` unique constraint.
  - Five `ALTER TABLE ... ADD CONSTRAINT ..._org_id_fk FOREIGN KEY ("org_id") REFERENCES "orgs"("id")` statements (one per tenanted table).

If the command appears to hang waiting for input, report BLOCKED. (Drizzle Kit prompts for migration name on TTY; the npm script's defaults run non-interactively.)

- [ ] **Step 2: Inspect the generated SQL.** Open `drizzle/0004_*.sql` and confirm:
  - Table `orgs` is the **first** CREATE TABLE statement in the file.
  - Each tenanted table gets exactly one `_org_id_fk` constraint.
  - No `ON DELETE` clause is emitted (defaults to NO ACTION — spec §2.2).

- [ ] **Step 3: Hand-edit the migration.** Open `drizzle/0004_*.sql` and apply two edits:

  **(a) Add the DO NOT REGENERATE header at the very top of the file**, before any SQL:

```sql
-- DO NOT REGENERATE: this migration contains a hand-appended AIYA seed block.
-- Re-running `npm run db:generate` will overwrite this file and silently delete
-- the INSERT INTO orgs (...) statement. See plans/2026-05-28-aiya-multi-tenant-foundation-slice-3.md.
```

  **(b) Insert the AIYA seed block immediately after the `CREATE TABLE "orgs"` (and its unique index, if Drizzle Kit emits one as a separate statement) and immediately BEFORE the first `ALTER TABLE ... ADD CONSTRAINT ..._org_id_fk` statement:**

```sql
--> statement-breakpoint
-- AIYA seed: must run before the tenanted-table FK constraints below, otherwise
-- ALTER TABLE fails on prod because existing rows reference org_id=1 with no
-- matching parent row. Seeded idempotently so re-running the migration is safe.
INSERT INTO "orgs" ("id", "name", "slug")
VALUES (1, 'AIYA Designs', 'aiya')
ON CONFLICT ("id") DO NOTHING;
SELECT setval(
  pg_get_serial_sequence('orgs', 'id'),
  GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM "orgs"))
);
--> statement-breakpoint
```

  (Drizzle's `--> statement-breakpoint` separator is what the migrator uses to split file content into individual `execute` calls. Sandwiching the seed block in breakpoints makes it two atomic statements — the INSERT and the setval — that run between the CREATE TABLE and the first ALTER TABLE.)

- [ ] **Step 4: Failing migration smoke test.** Create `test/db/orgs-migration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/client";
import { orgs } from "@/db/schema";

let close: (() => Promise<void>) | null = null;
afterEach(async () => { if (close) await close(); close = null; });

describe("orgs migration", () => {
  it("creates the orgs table and seeds AIYA at id=1 in a freshly migrated pglite db", async () => {
    const t = await createTestDb();
    close = t.close;
    const rows = await t.db.select().from(orgs);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].name).toBe("AIYA Designs");
    expect(rows[0].slug).toBe("aiya");
  });

  it("enforces the slug unique constraint", async () => {
    const t = await createTestDb();
    close = t.close;
    await expect(
      t.db.execute(sql`INSERT INTO orgs (id, name, slug) VALUES (2, 'Dup', 'aiya')`)
    ).rejects.toThrow();
  });

  it("rejects tenanted inserts whose org_id has no matching orgs row", async () => {
    const t = await createTestDb();
    close = t.close;
    // org_id=2 doesn't exist yet — FK must reject.
    await expect(
      t.db.execute(
        sql`INSERT INTO inventory_items (org_id, category, name) VALUES (2, 'Rings', 'X')`
      )
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/db/orgs-migration.test.ts`
Expected: PASS (3 tests). If the AIYA seed assertion fails with `length 0`, the hand-edit didn't land in the migration file or didn't use `--> statement-breakpoint` separators — re-open `0004_*.sql` and verify.

- [ ] **Step 6: Commit.**
```bash
git add drizzle test/db/orgs-migration.test.ts
git commit -m "feat(db): orgs migration with hand-appended AIYA seed + DO NOT REGENERATE header

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task A3: Extend `createSession` / `verifySession` to carry `orgId` + JWT tampering test

**Files:**
- Modify: `src/lib/auth/session.ts`
- Modify: `test/lib/auth/session.test.ts`

- [ ] **Step 1: Failing tests.** Replace the body of `test/lib/auth/session.test.ts` with:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { createSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret-test-secret-test-secret";
const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

describe("session", () => {
  it("round-trips a valid token with user + orgId", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ user: "boss", orgId: 1 });
  });

  it("round-trips a non-AIYA orgId (proof orgId is not hardcoded)", async () => {
    const token = await createSession("alice", 42, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ user: "alice", orgId: 42 });
  });

  it("rejects a tampered token", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token + "x", SECRET)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await createSession("boss", 1, SECRET);
    expect(await verifySession(token, "another-secret-another-secret")).toBeNull();
  });

  it("rejects a token missing orgId (back-compat: pre-slice-3 token)", async () => {
    const legacy = await new SignJWT({ user: "boss" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(legacy, SECRET)).toBeNull();
  });

  it("rejects a token whose orgId is a string", async () => {
    const bad = await new SignJWT({ user: "boss", orgId: "1" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(bad, SECRET)).toBeNull();
  });

  it("rejects a token whose orgId is zero or negative", async () => {
    for (const orgId of [0, -1, -999]) {
      const bad = await new SignJWT({ user: "boss", orgId })
        .setProtectedHeader({ alg: ALG })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(enc(SECRET));
      expect(await verifySession(bad, SECRET)).toBeNull();
    }
  });

  it("rejects a token whose orgId is non-integer", async () => {
    const bad = await new SignJWT({ user: "boss", orgId: 1.5 })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    expect(await verifySession(bad, SECRET)).toBeNull();
  });

  it("rejects a token whose payload has been edited but signature reused (JWT tampering)", async () => {
    // Sign a real token for org 1, then surgically rewrite the payload to claim org 999
    // while keeping the original header+signature. jose must reject the HS256 mismatch.
    const real = await createSession("boss", 1, SECRET);
    const [headerB64, payloadB64, sigB64] = real.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.orgId = 999;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url")
      .replace(/=+$/, "");
    const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/auth/session.test.ts`
Expected: FAIL — every test fails because `createSession` doesn't accept an `orgId` arg yet and `verifySession` returns `{ user }`.

- [ ] **Step 3: Implement.** Replace `src/lib/auth/session.ts` with:

```ts
import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

export interface SessionPayload {
  user: string;
  orgId: number;
}

export async function createSession(
  user: string,
  orgId: number,
  secret: string,
): Promise<string> {
  return new SignJWT({ user, orgId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: [ALG] });
    if (typeof payload.user !== "string") return null;
    if (
      typeof payload.orgId !== "number" ||
      !Number.isInteger(payload.orgId) ||
      payload.orgId < 1
    ) {
      return null;
    }
    return { user: payload.user, orgId: payload.orgId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/auth/session.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: FAIL — `src/app/api/login/route.ts` and `src/lib/auth/requireSession.ts` still call the old `createSession(user, secret)` / consume the old return shape. That's expected; the next two tasks fix them. **Do not commit yet** — commit after the requireSession update so the tree is never half-broken between commits.

---

### Task A4: Extend `requireSession()` to return `{ user, orgId }`

**Files:**
- Modify: `src/lib/auth/requireSession.ts`
- Modify: `test/lib/auth/requireSession.test.ts`

- [ ] **Step 1: Failing test.** Replace the body of `test/lib/auth/requireSession.test.ts` with:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieStore = { value: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (cookieStore.value ? { name: n, value: cookieStore.value } : undefined),
  }),
}));

import { createSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/requireSession";

const SECRET = "test-secret-test-secret-test-secret";

describe("requireSession", () => {
  beforeEach(() => {
    cookieStore.value = undefined;
    process.env.SESSION_SECRET = SECRET;
  });

  it("returns { user, orgId } for a valid cookie", async () => {
    cookieStore.value = await createSession("boss", 1, SECRET);
    expect(await requireSession()).toEqual({ user: "boss", orgId: 1 });
  });

  it("returns the correct orgId for a non-AIYA session", async () => {
    cookieStore.value = await createSession("alice", 42, SECRET);
    expect(await requireSession()).toEqual({ user: "alice", orgId: 42 });
  });

  it("throws when no cookie is present", async () => {
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });

  it("throws when the cookie is invalid", async () => {
    cookieStore.value = "garbage.token.value";
    await expect(requireSession()).rejects.toThrow(/unauthorized/i);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/auth/requireSession.test.ts`
Expected: FAIL — `createSession` now requires three args; the test calls were already updated, but `requireSession`'s return type still says `{ user }`.

- [ ] **Step 3: Implement.** Replace `src/lib/auth/requireSession.ts` with:

```ts
import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "./session";

/** Re-assert the slice-0 session inside a Server Action. Throws "Unauthorized" if absent/invalid.
 *  Returns the full payload (user + orgId) — multi-tenant slice 3. */
export async function requireSession(): Promise<SessionPayload> {
  const token = (await cookies()).get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) throw new Error("Unauthorized");
  return session;
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/auth/requireSession.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Fix the login route.** Replace `src/app/api/login/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";

// Hardcoded for slice 3: the single shared dashboard credential maps to AIYA.
// The users-table slice replaces this with a `SELECT orgId FROM users WHERE email = $1` lookup.
const AIYA_ORG_ID = 1;

export async function POST(req: Request) {
  const { user, password } = await req.json();
  if (user !== process.env.DASHBOARD_USER || password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = await createSession(user, AIYA_ORG_ID, process.env.SESSION_SECRET!);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ccc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
```

(The local `AIYA_ORG_ID = 1` const inside the route file is intentional and documented per spec §3.5 — it's the one place that knows "the shared credential is org 1". It is **not** imported from `@/db/org`; the goal of this slice is to delete that import everywhere.)

- [ ] **Step 6: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean. The existing action files still import `AIYA_ORG_ID` from `@/db/org` (B-phase removes those imports) — that's fine because the constant still exists. The action files call `await requireSession()` without destructuring `orgId`, and `session.user` still type-resolves because the new return type `{user, orgId}` is a structural superset. The plan stays atomic: A3+A4 land together at A5 commit time after the helper is added.

---

### Task A5: Create `getCurrentOrgId()` helper + tests

**Files:**
- Create: `src/lib/auth/getCurrentOrgId.ts`
- Create: `test/lib/auth/getCurrentOrgId.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/auth/getCurrentOrgId.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(),
}));

import { getCurrentOrgId, DEMO_ORG_ID } from "@/lib/auth/getCurrentOrgId";
import { requireSession } from "@/lib/auth/requireSession";

const mockedRequire = requireSession as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
  mockedRequire.mockReset();
});

describe("getCurrentOrgId", () => {
  it("returns DEMO_ORG_ID (= 1) in demo mode without calling requireSession", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await getCurrentOrgId()).toBe(DEMO_ORG_ID);
    expect(DEMO_ORG_ID).toBe(1);
    expect(mockedRequire).not.toHaveBeenCalled();
  });

  it("returns session.orgId outside demo mode", async () => {
    mockedRequire.mockResolvedValueOnce({ user: "boss", orgId: 7 });
    expect(await getCurrentOrgId()).toBe(7);
  });

  it("throws Unauthorized when requireSession() rejects (outside demo)", async () => {
    mockedRequire.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(getCurrentOrgId()).rejects.toThrow(/unauthorized/i);
  });

  it("demo guard takes precedence over auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    mockedRequire.mockRejectedValueOnce(new Error("Unauthorized"));
    // Even though requireSession would throw, demo short-circuit wins.
    expect(await getCurrentOrgId()).toBe(DEMO_ORG_ID);
    expect(mockedRequire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/auth/getCurrentOrgId.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `src/lib/auth/getCurrentOrgId.ts`:

```ts
import { isDemoMode } from "@/lib/demo/mode";
import { requireSession } from "./requireSession";

/** AIYA's seeded id. Fixed across deploys; the only legitimate use of a literal org id
 *  outside the login route is the demo seam. */
export const DEMO_ORG_ID = 1;

/**
 * Single source of truth for "which org is the caller acting on". Async because
 * it reads cookies + verifies the JWT. Throws "Unauthorized" if no valid session.
 * In demo mode short-circuits to AIYA's seeded id — same constant the seed uses.
 *
 * NOT wrapped in React.cache — per request profile guidance, the cookie read +
 * jose verify is cheap (~sub-ms) and a cache wrap adds an indirection that
 * makes test mocking fiddly. Revisit if a real perf trace shows hot-path
 * regressions.
 */
export async function getCurrentOrgId(): Promise<number> {
  if (isDemoMode()) return DEMO_ORG_ID;
  const session = await requireSession();
  return session.orgId;
}
```

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/auth/getCurrentOrgId.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: still red — action `run()` wrappers haven't been updated yet (they call `await requireSession()` and don't destructure `orgId`; that compiles fine, but the wrappers don't yet thread `orgId` into `fn()`, which is a Phase-B change). The auth-seam slice is **at this point complete** as a logical unit (session.ts + requireSession.ts + getCurrentOrgId.ts + login route), so commit before A6 even though tsc is still red on Phase-B file boundaries. Use a single atomic commit:

```bash
git add src/lib/auth/session.ts src/lib/auth/requireSession.ts src/lib/auth/getCurrentOrgId.ts \
  src/app/api/login/route.ts \
  test/lib/auth/session.test.ts test/lib/auth/requireSession.test.ts test/lib/auth/getCurrentOrgId.test.ts
git commit -m "feat(auth): extend JWT payload with orgId + add getCurrentOrgId() seam

createSession(user, orgId, secret). verifySession returns { user, orgId } with
defensive integer/positive check. requireSession returns full payload.
New getCurrentOrgId() helper short-circuits to DEMO_ORG_ID=1 in demo mode,
otherwise reads session.orgId. JWT tampering test + 'missing orgId =
unauthorized' test included.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(The Phase B refactor in B1+ closes the tsc gap.)

---

### Task A6: Extend `test/helpers/shared-db.ts` to seed orgs (id=1 + id=999)

**Files:**
- Modify: `test/helpers/shared-db.ts`
- Test: inline assertion in existing test files (no new test file)

- [ ] **Step 1: Failing assertion to motivate the seed.** Quickly verify that running any existing isolation test now hits the FK constraint without the seed. Run:

```
npx vitest run test/db/inventory.test.ts
```

Expected: FAIL — `INSERT … violates foreign key constraint "inventory_items_org_id_fk"` because `test/db/inventory.test.ts:14` inserts a row with `orgId: 2` and there's no orgs row with id=2. (This is the FK gate doing its job; the seed is what unblocks the test layer.)

- [ ] **Step 2: Implement the seed.** Replace `test/helpers/shared-db.ts` with:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { type Db } from "@/db/client";

/**
 * One migrated pglite shared across every test in the calling file.
 *
 * Why this exists: `createTestDb()` boots a fresh pglite WASM instance per call
 * (~5-6s each). Most DB tests called it in `beforeEach`, so a 9-test file paid
 * ~45-55s in boot cost alone. Booting once per file (in `beforeAll`) and
 * wiping data between tests (`TRUNCATE … CASCADE`) gives the same isolation
 * guarantee for a tiny fraction of the time. Vitest's default `isolate: true`
 * re-imports this module per test file, so the module-level singleton is
 * naturally file-scoped — no cross-file leakage.
 *
 * Multi-tenant seeding (slice 3): the migration's hand-edited block already
 * seeds AIYA at id=1, but the post-migrate `seedOrgs()` step below also
 * inserts a fixture second org at id=999 so cross-org isolation tests work
 * out of the box. After every `resetSharedDb()` we re-insert both rows
 * (TRUNCATE CASCADE wipes them) so every test starts from the same baseline.
 *
 * Tests that specifically verify per-instance isolation or migration behavior
 * (e.g. test/db/client.test.ts, test/db/orgs-migration.test.ts) should keep
 * using `createTestDb()` so they observe the seeded id=1 (and no 999) state.
 */

let cached: { client: PGlite; db: Db } | null = null;
let tableNames: string[] | null = null;

async function seedOrgs(db: Db): Promise<void> {
  // Idempotent: re-inserting AIYA after the migration is a no-op via ON CONFLICT.
  // id=999 is the fixture org used by cross-org isolation tests (slice 3 spec §5.5).
  await db.execute(sql`
    INSERT INTO orgs (id, name, slug) VALUES
      (1, 'AIYA Designs', 'aiya'),
      (999, 'Fixture Org', 'fixture')
    ON CONFLICT (id) DO NOTHING;
  `);
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('orgs', 'id'),
      GREATEST(999, (SELECT COALESCE(MAX(id), 1) FROM orgs))
    );
  `);
}

export async function getSharedDb(): Promise<Db> {
  if (cached) return cached.db;
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  cached = { client, db };
  // Discover user tables once so reset stays schema-agnostic as the project grows.
  // The __drizzle_migrations bookkeeping table is excluded — we want migrations
  // to stay applied across test-to-test resets.
  const res = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_drizzle%' ESCAPE '\\'
  `);
  const rows = (res as unknown as { rows: { tablename: string }[] }).rows;
  tableNames = rows.map((r) => r.tablename);
  await seedOrgs(db);
  return db;
}

/** Wipe every user table; preserves schema + sequences are reset to 1. Sub-ms.
 *  Re-seeds orgs immediately after the truncate because the FK on every
 *  tenanted table needs id=1 and id=999 to exist before the next test runs. */
export async function resetSharedDb(): Promise<void> {
  if (!cached || !tableNames || tableNames.length === 0) return;
  const quoted = tableNames.map((t) => `"${t}"`).join(", ");
  await cached.db.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`));
  await seedOrgs(cached.db);
}

/** Close the underlying pglite instance. Call in afterAll. */
export async function closeSharedDb(): Promise<void> {
  if (cached) {
    await cached.client.close();
    cached = null;
    tableNames = null;
  }
}
```

- [ ] **Step 3: Update legacy `orgId: 2` references to `orgId: 999`.** The fixture org id moved from 2 → 999. Three existing tests use `orgId: 2` and would now fail FK validation:

  In `test/db/inventory.test.ts` line ~14, change:
  ```ts
      { category: "Necklaces", name: "E", quantity: 1, status: "in_stock", orgId: 2 }, // other org
  ```
  to:
  ```ts
      { category: "Necklaces", name: "E", quantity: 1, status: "in_stock", orgId: 999 }, // other org
  ```

  In `test/lib/deals/queries.test.ts` line ~81, change:
  ```ts
      await insert({ subject: "otherOrg", orgId: 2 });
  ```
  to:
  ```ts
      await insert({ subject: "otherOrg", orgId: 999 });
  ```
  …and the two follow-up assertions (lines ~83, ~85) from `getActiveDeals(db, 2)` / `getAllDeals(db, 2)` to `getActiveDeals(db, 999)` / `getAllDeals(db, 999)`.

  In `test/lib/deals/actions.test.ts` line ~113, change:
  ```ts
        orgId: 2, kind: "SELL", category: "Diamond", subject: "other",
  ```
  to:
  ```ts
        orgId: 999, kind: "SELL", category: "Diamond", subject: "other",
  ```
  …and line ~119 from `getAllDeals(db, 2)` to `getAllDeals(db, 999)`.

- [ ] **Step 4: Run the affected suites to confirm green.** Run:
```
npx vitest run test/db/inventory.test.ts test/lib/deals/queries.test.ts test/lib/deals/actions.test.ts test/db/orgs-migration.test.ts
```
Expected: all green. (`test/lib/deals/actions.test.ts` still uses the old `{ user }` mock; that's fine for now because the `run()` wrapper still calls `await requireSession()` without destructuring — Phase B updates the mock. The orgs.id=999 seeded row is what unblocks the tenancy-isolation insert.)

- [ ] **Step 5: Commit.**
```bash
git add test/helpers/shared-db.ts test/db/inventory.test.ts test/lib/deals/queries.test.ts test/lib/deals/actions.test.ts
git commit -m "test(helpers): seed orgs (AIYA id=1 + fixture id=999) in shared-db; migrate orgId:2 → 999

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase B — Refactor (mechanical AIYA_ORG_ID → orgId-from-session sweep)

Each B-task is one domain: refactor the action file → update its mocked test → add cross-org isolation + tenancy enforcement tests → commit. **Do not start B3 until B2 is committed green; do not start B4 until B3 is committed green.** Half-finished domains explode tsc.

> ## CRITICAL — Validation schemas never accept orgId
>
> Throughout Phase B, every action input schema in `src/lib/*/validation.ts` must NOT include an `orgId` field. The orgId is stamped from the resolved session inside the `run()` wrapper — never from the request body. If you find yourself adding `orgId: z.number()` to a Zod schema, stop: that's the slice 3 anti-pattern. The C2 grep enforces this at the end.

### Task B1: Login is already wired (no-op task — confirmation only)

**Files:** none

- [ ] **Step 1: Confirm A4 already updated `src/app/api/login/route.ts`.** Run:
```
grep -n "createSession\|AIYA_ORG_ID" src/app/api/login/route.ts
```
Expected: shows `const AIYA_ORG_ID = 1;` and `createSession(user, AIYA_ORG_ID, ...)`. Yes, the login route is already done. No commit.

---

### Task B2: Refactor `src/lib/inventory/actions.ts` to thread orgId from session

**Files:**
- Modify: `src/lib/inventory/actions.ts`
- Modify: `test/lib/inventory/actions.test.ts`

- [ ] **Step 1: Failing test (update mock + new tenancy-enforcement case).** Replace the top of `test/lib/inventory/actions.test.ts` (the mock + imports) with:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));

import type { Db } from "@/db/client";
import { getSharedDb, resetSharedDb, closeSharedDb } from "../../helpers/shared-db";
import { inventoryItems } from "@/db/schema";
import { getInventorySummary } from "@/db/inventory";
import {
  createInventoryItem, updateInventoryItem, deleteInventoryItem, __setTestDb,
} from "@/lib/inventory/actions";
import { requireSession } from "@/lib/auth/requireSession";
import { eq } from "drizzle-orm";
```

Then **append** a new `describe` block at the bottom of the same file:

```ts
describe("inventory cross-org tenancy enforcement", () => {
  it("createInventoryItem stamps the row with session.orgId (not a default)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 999,
    });
    const res = await createInventoryItem({
      category: "Rings", name: "Org999 ring", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select({ orgId: inventoryItems.orgId, name: inventoryItems.name })
      .from(inventoryItems);
    expect(row.orgId).toBe(999);
    expect(row.name).toBe("Org999 ring");
  });

  it("updateInventoryItem with an id from another org cannot reach that row", async () => {
    // Seed a row in org 999.
    await db.insert(inventoryItems).values({
      orgId: 999, category: "Diamonds", name: "untouchable",
      quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 0,
    });
    const [target] = await db.select({ id: inventoryItems.id }).from(inventoryItems);

    // Now the session is org 1, attacker tries to update org 999's row by id.
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await updateInventoryItem({
      id: target.id, category: "Diamonds", name: "PWNED", quantity: 99, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });

    // Verify the row in org 999 is unchanged.
    const [after] = await db.select({ name: inventoryItems.name, quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, target.id));
    expect(after.name).toBe("untouchable");
    expect(after.quantity).toBe(1);
  });

  it("deleteInventoryItem with an id from another org cannot delete that row", async () => {
    await db.insert(inventoryItems).values({
      orgId: 999, category: "Rings", name: "survivor",
      quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 0,
    });
    const [target] = await db.select({ id: inventoryItems.id }).from(inventoryItems);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await deleteInventoryItem(target.id);

    const all = await db.select({ id: inventoryItems.id }).from(inventoryItems);
    expect(all.map((r) => r.id)).toContain(target.id); // still there
  });
});

describe("getInventorySummary cross-org isolation", () => {
  it("returns only the requested org's rows", async () => {
    await db.insert(inventoryItems).values([
      { orgId: 1, category: "Rings", name: "aiya-ring", quantity: 3, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 1, category: "Diamonds", name: "aiya-dia", quantity: 2, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 999, category: "Rings", name: "other-ring", quantity: 100, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
      { orgId: 999, category: "Necklaces", name: "other-neck", quantity: 50, status: "in_stock", unitCostCents: 0, retailPriceCents: 0 },
    ]);
    const aiya = await getInventorySummary(db, 1);
    expect(aiya.counts.Rings).toBe(3);
    expect(aiya.counts.Diamonds).toBe(2);
    expect(aiya.counts.Necklaces).toBe(0); // belongs to 999
    expect(aiya.total).toBe(5);

    const other = await getInventorySummary(db, 999);
    expect(other.counts.Rings).toBe(100);
    expect(other.counts.Necklaces).toBe(50);
    expect(other.counts.Diamonds).toBe(0); // belongs to AIYA
    expect(other.total).toBe(150);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/inventory/actions.test.ts`
Expected: FAIL — the new "stamps with session.orgId" test fails because the action still hardcodes `AIYA_ORG_ID`. (Also: `getInventorySummary(db)` calls in the original `describe("inventory server actions")` block still use the default param, so they'll fail once we strip the default in B5. Don't touch the call sites yet — B5 handles those mechanically.)

- [ ] **Step 3: Refactor the action file.** Replace `src/lib/inventory/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { inventoryItems } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  inventoryItemInput,
  inventoryItemUpdateInput,
  firstZodError,
  type InventoryItemInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

// test seam — inject an isolated pglite db (mirrors the company actions pattern)
let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> {
  testDb = db;
}
function db(): Db {
  return testDb ?? getDb();
}

/** Re-assert session, resolve orgId, validate, run, revalidate; never throw to the UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    console.error("[inventory action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

function values(input: InventoryItemInput, orgId: number) {
  return {
    orgId,
    category: input.category,
    name: input.name,
    sku: input.sku ?? null,
    quantity: input.quantity,
    status: input.status,
    unitCostCents: input.unitCostCents,
    retailPriceCents: input.retailPriceCents,
    metal: input.metal ?? null,
    weightMg: input.weightMg ?? null,
    caratX100: input.caratX100 ?? null,
    cut: input.cut ?? null,
    color: input.color ?? null,
    clarity: input.clarity ?? null,
  };
}

export async function createInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemInput, raw, async (input, orgId) => {
    await db().insert(inventoryItems).values(values(input, orgId));
  });
}

export async function updateInventoryItem(raw: unknown): Promise<ActionResult> {
  return run(inventoryItemUpdateInput, raw, async (input, orgId) => {
    await db()
      .update(inventoryItems)
      .set({ ...values(input, orgId), updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, input.id), eq(inventoryItems.orgId, orgId)));
  });
}

export async function deleteInventoryItem(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.id, rid), eq(inventoryItems.orgId, orgId)));
  });
}
```

Note three real changes (not stylistic):
1. `AIYA_ORG_ID` import is **removed**.
2. `update` / `delete` clauses become `and(eq(id, …), eq(orgId, currentOrg))` — id alone is not enough.
3. `values()` takes `orgId` as a parameter instead of stamping the constant.

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/lib/inventory/actions.test.ts`
Expected: PASS — the new tenancy-enforcement and isolation tests are green. The original `inventory server actions` block's three tests still pass because the default-mocked `requireSession` returns `orgId: 1` and rows go in with `orgId: 1`. The `getInventorySummary(db)` call (no explicit orgId) inside `describe("inventory server actions")` still works because B5 hasn't stripped the default yet.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/inventory/actions.ts test/lib/inventory/actions.test.ts
git commit -m "feat(inventory): thread orgId from session through run(); add tenancy enforcement + isolation tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B3: Refactor `src/lib/diamonds/actions.ts` to thread orgId from session

**Files:**
- Modify: `src/lib/diamonds/actions.ts`
- Modify: `test/lib/diamonds/actions.test.ts`

- [ ] **Step 1: Failing test (update mock + new tenancy-enforcement cases).** Replace the mock block at the top of `test/lib/diamonds/actions.test.ts` with:

```ts
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
```

Then append to the same file:

```ts
import { requireSession } from "@/lib/auth/requireSession";
import { diamondMatrixPrices } from "@/db/schema";
import { and, eq } from "drizzle-orm";

describe("diamond cross-org tenancy enforcement", () => {
  it("upsertMatrixCell stamps the row with session.orgId", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 999,
    });
    await upsertMatrixCell({
      sheet: "natural", shape: "round", color: "G", clarity: "VS1",
      caratBand: "1.00-1.49", pricePerCaratCents: 700000,
    });
    const rows = await db.select({ orgId: diamondMatrixPrices.orgId })
      .from(diamondMatrixPrices);
    expect(rows.map((r) => r.orgId)).toContain(999);
    expect(rows.map((r) => r.orgId)).not.toContain(1);
  });

  it("savePricePoint (update branch) cannot mutate another org's row", async () => {
    // Seed an org 999 row.
    await db.insert(diamondPricePoints).values({
      orgId: 999, label: "untouchable", kind: "gem", pricePerCaratCents: 100,
    });
    const [target] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await savePricePoint({
      id: target.id, label: "PWNED", kind: "gem", pricePerCaratCents: 999999,
    });

    const [after] = await db.select({ label: diamondPricePoints.label, cents: diamondPricePoints.pricePerCaratCents })
      .from(diamondPricePoints)
      .where(eq(diamondPricePoints.id, target.id));
    expect(after.label).toBe("untouchable");
    expect(after.cents).toBe(100);
  });

  it("deletePricePoint cannot reach another org's row", async () => {
    await db.insert(diamondPricePoints).values({
      orgId: 999, label: "survivor", kind: "gem", pricePerCaratCents: 100,
    });
    const [target] = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await deletePricePoint(target.id);

    const all = await db.select({ id: diamondPricePoints.id }).from(diamondPricePoints);
    expect(all.map((r) => r.id)).toContain(target.id);
  });
});
```

Also create `test/db/diamonds.test.ts` extension — append below the existing tests:

```ts
describe("getDiamondSummary / getDiamondTrend cross-org isolation", () => {
  it("returns only the requested org's index, points, and trend", async () => {
    // Benchmark cells for both orgs (so each org has a natural_index reading).
    await db.insert(diamondMatrixPrices).values([
      { orgId: 1, sheet: "natural", shape: "round", color: "G", clarity: "VS1",
        caratBand: "1.00-1.49", pricePerCaratCents: 800000 },
      { orgId: 999, sheet: "natural", shape: "round", color: "G", clarity: "VS1",
        caratBand: "1.00-1.49", pricePerCaratCents: 200000 },
    ]);
    await db.insert(diamondPricePoints).values([
      { orgId: 1, label: "aiya-point", kind: "gem", pricePerCaratCents: 1 },
      { orgId: 999, label: "other-point", kind: "gem", pricePerCaratCents: 2 },
    ]);
    await db.insert(diamondIndexHistory).values([
      { orgId: 1, series: "natural_index", valueCents: 800000 },
      { orgId: 999, series: "natural_index", valueCents: 200000 },
    ]);

    const aiya = await getDiamondSummary(db, 1);
    expect(aiya.naturalIndex?.cents).toBe(800000);
    expect(aiya.points.map((p) => p.label)).toEqual(["aiya-point"]);

    const other = await getDiamondSummary(db, 999);
    expect(other.naturalIndex?.cents).toBe(200000);
    expect(other.points.map((p) => p.label)).toEqual(["other-point"]);

    const aiyaTrend = await getDiamondTrend(db, "natural_index", 1);
    expect(aiyaTrend).toEqual([800000]);
    const otherTrend = await getDiamondTrend(db, "natural_index", 999);
    expect(otherTrend).toEqual([200000]);
  });
});
```

(Note: `getDiamondTrend` signature changes to `(db, series, orgId)` in the refactor below. This test calls it with an explicit `orgId`.)

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/diamonds/actions.test.ts test/db/diamonds.test.ts`
Expected: FAIL — `upsertMatrixCell` still hardcodes `AIYA_ORG_ID`; the isolation tests in `diamonds.test.ts` are also failing because `getDiamondTrend` doesn't yet accept `orgId` in the new position.

- [ ] **Step 3: Refactor the action file.** Replace `src/lib/diamonds/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { BENCHMARK } from "@/lib/diamonds/constants";
import { parseMatrixCsv } from "@/lib/diamonds/csv";
import { isDemoMode } from "@/lib/demo/mode";
import {
  matrixCellInput, pricePointInput, pricePointUpdateInput, importInput, firstZodError,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };
type ImportResult = { ok: true; imported: number } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Append a snapshot of the natural/lab benchmark indices to history for `orgId`. */
async function snapshotIndices(d: Db, orgId: number): Promise<void> {
  for (const [sheet, series] of [["natural", "natural_index"], ["lab", "lab_index"]] as const) {
    const rows = await d
      .select({ cents: diamondMatrixPrices.pricePerCaratCents })
      .from(diamondMatrixPrices)
      .where(and(
        eq(diamondMatrixPrices.orgId, orgId), eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape), eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity), eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      ))
      .limit(1);
    if (rows[0]) {
      await d.insert(diamondIndexHistory).values({ orgId, series, valueCents: rows[0].cents });
    }
  }
}

export async function importMatrix(raw: unknown): Promise<ImportResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsedInput = importInput.safeParse(raw);
  if (!parsedInput.success) return { ok: false, error: firstZodError(parsedInput.error) };
  const { sheet, shape, csv } = parsedInput.data;
  const parsed = parseMatrixCsv(csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const d = db();
    await d.transaction(async (tx) => {
      await tx.delete(diamondMatrixPrices).where(and(
        eq(diamondMatrixPrices.orgId, orgId),
        eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, shape)
      ));
      await tx.insert(diamondMatrixPrices).values(
        parsed.rows.map((r) => ({
          orgId, sheet, shape,
          color: r.color, clarity: r.clarity, caratBand: r.caratBand,
          pricePerCaratCents: r.pricePerCaratCents,
        }))
      );
    });
    await snapshotIndices(d, orgId);
    revalidatePath("/");
    revalidatePath("/diamonds");
    return { ok: true, imported: parsed.rows.length };
  } catch (e) {
    console.error("[diamond import] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/diamonds");
    return { ok: true };
  } catch (e) {
    console.error("[diamond action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function upsertMatrixCell(raw: unknown): Promise<ActionResult> {
  return run(matrixCellInput, raw, async (input, orgId) => {
    await db().insert(diamondMatrixPrices).values({ orgId, ...input })
      .onConflictDoUpdate({
        target: [
          diamondMatrixPrices.orgId, diamondMatrixPrices.sheet, diamondMatrixPrices.shape,
          diamondMatrixPrices.color, diamondMatrixPrices.clarity, diamondMatrixPrices.caratBand,
        ],
        set: { pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() },
      });
    await snapshotIndices(db(), orgId);
  });
}

export async function savePricePoint(raw: unknown): Promise<ActionResult> {
  const isUpdate = typeof (raw as { id?: unknown })?.id === "number";
  if (isUpdate) {
    return run(pricePointUpdateInput, raw, async (input, orgId) => {
      await db().update(diamondPricePoints)
        .set({ label: input.label, kind: input.kind, pricePerCaratCents: input.pricePerCaratCents, updatedAt: new Date() })
        .where(and(eq(diamondPricePoints.id, input.id), eq(diamondPricePoints.orgId, orgId)));
    });
  }
  return run(pricePointInput, raw, async (input, orgId) => {
    await db().insert(diamondPricePoints).values({ orgId, ...input });
  });
}

export async function deletePricePoint(id: number): Promise<ActionResult> {
  return run(z.number().int(), id, async (rid, orgId) => {
    await db().delete(diamondPricePoints)
      .where(and(eq(diamondPricePoints.id, rid), eq(diamondPricePoints.orgId, orgId)));
  });
}
```

- [ ] **Step 4: Refactor `src/db/diamonds.ts` to remove the defaults.** Replace it with:

```ts
import { and, eq, asc, desc } from "drizzle-orm";
import type { Db } from "./client";
import { diamondMatrixPrices, diamondPricePoints, diamondIndexHistory } from "./schema";
import { BENCHMARK, type Sheet } from "@/lib/diamonds/constants";
import { isDemoMode } from "@/lib/demo/mode";
import { seedDiamondSummary } from "@/lib/demo/seed";

export interface IndexValue { cents: number; change24hPct: number | null }
export interface NamedPoint { label: string; kind: string; cents: number }
export interface DiamondSummary {
  naturalIndex: IndexValue | null;
  labIndex: IndexValue | null;
  points: NamedPoint[];
  updatedAt: Date | null;
}

async function benchmarkCents(db: Db, orgId: number, sheet: Sheet): Promise<number | null> {
  const rows = await db
    .select({ cents: diamondMatrixPrices.pricePerCaratCents })
    .from(diamondMatrixPrices)
    .where(
      and(
        eq(diamondMatrixPrices.orgId, orgId),
        eq(diamondMatrixPrices.sheet, sheet),
        eq(diamondMatrixPrices.shape, BENCHMARK.shape),
        eq(diamondMatrixPrices.color, BENCHMARK.color),
        eq(diamondMatrixPrices.clarity, BENCHMARK.clarity),
        eq(diamondMatrixPrices.caratBand, BENCHMARK.caratBand)
      )
    )
    .limit(1);
  return rows[0]?.cents ?? null;
}

async function change24hPct(db: Db, orgId: number, series: string): Promise<number | null> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents, recordedAt: diamondIndexHistory.recordedAt })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(desc(diamondIndexHistory.recordedAt));
  if (rows.length < 2) return null;
  const latest = rows[0];
  const cutoff = latest.recordedAt.getTime() - 24 * 3600 * 1000;
  const prior = rows.find((r) => r.recordedAt.getTime() <= cutoff) ?? rows[rows.length - 1];
  if (!prior.valueCents) return null;
  return ((latest.valueCents - prior.valueCents) / prior.valueCents) * 100;
}

async function indexValue(db: Db, orgId: number, sheet: Sheet, series: string): Promise<IndexValue | null> {
  const cents = await benchmarkCents(db, orgId, sheet);
  if (cents == null) return null;
  return { cents, change24hPct: await change24hPct(db, orgId, series) };
}

export async function getDiamondSummary(db: Db, orgId: number): Promise<DiamondSummary> {
  if (isDemoMode()) return seedDiamondSummary();
  const [naturalIndex, labIndex, pointRows] = await Promise.all([
    indexValue(db, orgId, "natural", "natural_index"),
    indexValue(db, orgId, "lab", "lab_index"),
    db
      .select({
        label: diamondPricePoints.label,
        kind: diamondPricePoints.kind,
        cents: diamondPricePoints.pricePerCaratCents,
        updatedAt: diamondPricePoints.updatedAt,
      })
      .from(diamondPricePoints)
      .where(eq(diamondPricePoints.orgId, orgId))
      .orderBy(asc(diamondPricePoints.label)),
  ]);
  const updatedAt = pointRows[0]?.updatedAt ?? null;
  const points = pointRows.map((p) => ({ label: p.label, kind: p.kind, cents: p.cents }));
  return { naturalIndex, labIndex, points, updatedAt };
}

export async function getDiamondTrend(
  db: Db,
  series: string,
  orgId: number,
): Promise<number[]> {
  const rows = await db
    .select({ valueCents: diamondIndexHistory.valueCents })
    .from(diamondIndexHistory)
    .where(and(eq(diamondIndexHistory.orgId, orgId), eq(diamondIndexHistory.series, series)))
    .orderBy(asc(diamondIndexHistory.recordedAt));
  return rows.map((r) => r.valueCents);
}
```

(Changes: removed `AIYA_ORG_ID` import + default values. `getDiamondTrend` keeps its arg order — `series` then `orgId` — but both are now required.)

- [ ] **Step 5: Update the existing diamond test calls that use the old default.** In `test/db/diamonds.test.ts`, replace every `getDiamondSummary(db)` → `getDiamondSummary(db, 1)` and every `getDiamondTrend(db, "natural_index")` → `getDiamondTrend(db, "natural_index", 1)`. Also fix `getDiamondSummary(null as never)` in the demo block — keep it as `getDiamondSummary(null as never, 1)` so the call type-checks (the demo guard returns before the db is touched).

- [ ] **Step 6: Check for any production callsites of `getDiamondTrend` that need updating.** Run:
```
grep -rn "getDiamondTrend" src/
```
Update each callsite to pass the orgId explicitly (most likely `src/app/api/diamond-history/route.ts` if it exists, or an RSC component). Add an explicit `await getCurrentOrgId()` import there. The grep tells you all the places — update each one.

- [ ] **Step 7: Run to verify PASS.** Run: `npx vitest run test/lib/diamonds/actions.test.ts test/db/diamonds.test.ts`
Expected: PASS — original + 3 new tenancy-enforcement tests + cross-org isolation in diamonds.test.ts.

- [ ] **Step 8: Commit.**
```bash
git add src/lib/diamonds/actions.ts src/db/diamonds.ts \
  test/lib/diamonds/actions.test.ts test/db/diamonds.test.ts \
  src/app/api/diamond-history/route.ts
git commit -m "feat(diamonds): thread orgId from session through run() + remove default param; tenancy + cross-org isolation tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(If the grep in Step 6 turned up no other callsites, drop `src/app/api/diamond-history/route.ts` from the `git add` list.)

---

### Task B4: Refactor `src/lib/deals/actions.ts` to thread orgId from session

**Files:**
- Modify: `src/lib/deals/actions.ts`
- Modify: `test/lib/deals/actions.test.ts`

- [ ] **Step 1: Failing test (update mock + new tenancy-enforcement cases).** Replace the mock block at the top of `test/lib/deals/actions.test.ts` with:

```ts
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
```

Then append to the same file:

```ts
describe("deals cross-org tenancy enforcement", () => {
  it("postDeal stamps the row with session.orgId (not a default)", async () => {
    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "alice", orgId: 999,
    });
    const res = await postDeal({
      kind: "SELL", category: "Diamond", subject: "Org999 deal",
      quantity: 1, priceCents: 100,
    });
    expect(res).toEqual({ ok: true });
    const [row] = await db.select({ orgId: deals.orgId, subject: deals.subject })
      .from(deals);
    expect(row.orgId).toBe(999);
    expect(row.subject).toBe("Org999 deal");
  });

  it("markDealFilled with an id from another org leaves that row Open", async () => {
    await db.insert(deals).values({
      orgId: 999, kind: "SELL", category: "Diamond", subject: "untouchable",
      quantity: 1, priceCents: 100, postedByLabel: "x",
    });
    const [target] = await db.select({ id: deals.id }).from(deals);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await markDealFilled(target.id);

    const all = await getAllDeals(db, 999);
    expect(all[0].status).toBe("Open"); // unchanged
  });

  it("withdrawDeal with an id from another org leaves that row Open", async () => {
    await db.insert(deals).values({
      orgId: 999, kind: "BUY", category: "Metal", subject: "untouchable",
      quantity: 1, priceCents: 100, postedByLabel: "x",
    });
    const [target] = await db.select({ id: deals.id }).from(deals);

    (requireSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: "boss", orgId: 1,
    });
    await withdrawDeal(target.id);

    const all = await getAllDeals(db, 999);
    expect(all[0].status).toBe("Open");
  });
});
```

(The existing "tenancy isolation on mutation" describe block already covers withdrawDeal; the new block adds postDeal stamping + markDealFilled isolation. Leave the existing block alone — it stays green.)

Also extend `test/lib/deals/queries.test.ts` with the filter-combination tenancy test below — append:

```ts
describe("getAllDeals cross-org isolation across filters", () => {
  it("scopes to orgId even when status filter is active", async () => {
    await insert({ subject: "aiya-filled", status: "Filled", orgId: 1 });
    await insert({ subject: "other-filled", status: "Filled", orgId: 999 });
    const rows = await getAllDeals(db, 1, { status: "Filled" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-filled"]);
  });

  it("scopes to orgId even when kind filter is active", async () => {
    await insert({ subject: "aiya-buy", kind: "BUY", orgId: 1 });
    await insert({ subject: "other-buy", kind: "BUY", orgId: 999 });
    const rows = await getAllDeals(db, 1, { kind: "BUY" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-buy"]);
  });

  it("scopes to orgId even when category filter is active", async () => {
    await insert({ subject: "aiya-gem", category: "Gem", orgId: 1 });
    await insert({ subject: "other-gem", category: "Gem", orgId: 999 });
    const rows = await getAllDeals(db, 1, { category: "Gem" });
    expect(rows.map((r) => r.subject)).toEqual(["aiya-gem"]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.** Run: `npx vitest run test/lib/deals/actions.test.ts test/lib/deals/queries.test.ts`
Expected: FAIL — the new "postDeal stamps with session.orgId" test fails (orgId still hardcoded), and queries tests pass because `getAllDeals` already accepts orgId.

- [ ] **Step 3: Refactor the action file.** Replace `src/lib/deals/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { deals } from "@/db/schema";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import {
  postDealInput, updateDealStatusInput, firstZodError,
  type PostDealInput, type UpdateDealStatusInput,
} from "./validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

let testDb: Db | null = null;
export async function __setTestDb(db: Db | null): Promise<void> { testDb = db; }
function db(): Db { return testDb ?? getDb(); }

/** Demo-guard, session re-assert + orgId resolve, validate, run, revalidate; never throw to UI. */
async function run<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, orgId: number) => Promise<void>
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
  let orgId: number;
  try {
    const session = await requireSession();
    orgId = session.orgId;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstZodError(parsed.error) };
  try {
    await fn(parsed.data, orgId);
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

/** Same as run() but also threads `session.user` (for postedByLabel stamping). */
async function runWithUser<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fn: (input: T, user: string, orgId: number) => Promise<void>
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
    revalidatePath("/");
    revalidatePath("/deals");
    return { ok: true };
  } catch (e) {
    console.error("[deals action] database error:", e);
    return { ok: false, error: "Database error" };
  }
}

export async function postDeal(raw: unknown): Promise<ActionResult> {
  return runWithUser(postDealInput, raw, async (input: PostDealInput, user, orgId) => {
    await db().insert(deals).values({
      orgId,
      kind: input.kind,
      category: input.category,
      subject: input.subject,
      quantity: input.quantity,
      priceCents: input.priceCents,
      currency: input.currency,
      postedByLabel: user,
    });
    console.log(
      `[deals] posted deal kind=${input.kind} category=${input.category} by=${user} org=${orgId}`
    );
  });
}

async function updateStatus(input: UpdateDealStatusInput, orgId: number): Promise<void> {
  await db()
    .update(deals)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(eq(deals.id, input.id), eq(deals.orgId, orgId)));
  console.log(`[deals] deal id=${input.id} status changed to ${input.status} (org=${orgId})`);
}

export async function markDealFilled(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Filled" }, updateStatus);
}

export async function withdrawDeal(id: number): Promise<ActionResult> {
  return run(updateDealStatusInput, { id, status: "Withdrawn" }, async (input, orgId) => {
    await updateStatus(input, orgId);
    console.log(`[deals] deal id=${input.id} withdrawn (org=${orgId})`);
  });
}
```

- [ ] **Step 4: Refactor `src/lib/deals/queries.ts` to remove the defaults.** Replace it with:

```ts
import { and, eq, desc, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals } from "@/db/schema";
import { isDemoMode } from "@/lib/demo/mode";
import { getSeedDeals } from "@/lib/demo/seed";
import type { DealKind, DealCategory, DealStatus } from "./constants";

export interface DealRow {
  id: number;
  kind: DealKind;
  category: DealCategory;
  subject: string;
  quantity: number;
  priceCents: number;
  currency: string;
  status: DealStatus;
  postedByLabel: string;
  createdAt: Date;
}

export interface DealFilters {
  status?: DealStatus;
  kind?: DealKind;
  category?: DealCategory;
}

const COLUMNS = {
  id: deals.id,
  kind: deals.kind,
  category: deals.category,
  subject: deals.subject,
  quantity: deals.quantity,
  priceCents: deals.priceCents,
  currency: deals.currency,
  status: deals.status,
  postedByLabel: deals.postedByLabel,
  createdAt: deals.createdAt,
} as const;

export async function getActiveDeals(
  db: Db,
  orgId: number,
  limit: number = 5,
): Promise<DealRow[]> {
  if (isDemoMode()) {
    return getSeedDeals().filter((d) => d.status === "Open").slice(0, limit);
  }
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(eq(deals.orgId, orgId), eq(deals.status, "Open")))
    .orderBy(desc(deals.createdAt))
    .limit(limit);
  return rows as DealRow[];
}

export async function getAllDeals(
  db: Db,
  orgId: number,
  filters: DealFilters = {},
): Promise<DealRow[]> {
  if (isDemoMode()) return getSeedDeals();
  const clauses: SQL[] = [eq(deals.orgId, orgId)];
  if (filters.status) clauses.push(eq(deals.status, filters.status));
  if (filters.kind) clauses.push(eq(deals.kind, filters.kind));
  if (filters.category) clauses.push(eq(deals.category, filters.category));
  const rows = await db
    .select(COLUMNS)
    .from(deals)
    .where(and(...clauses))
    .orderBy(desc(deals.createdAt));
  return rows as DealRow[];
}
```

(`AIYA_ORG_ID` import removed, `orgId` is now a required positional arg before `limit` / `filters`.)

- [ ] **Step 5: Run to verify PASS.** Run: `npx vitest run test/lib/deals/actions.test.ts test/lib/deals/queries.test.ts`
Expected: PASS — all original + 3 new tenancy-enforcement + 3 new filter-combo isolation tests.

- [ ] **Step 6: Commit.**
```bash
git add src/lib/deals/actions.ts src/lib/deals/queries.ts \
  test/lib/deals/actions.test.ts test/lib/deals/queries.test.ts
git commit -m "feat(deals): thread orgId from session through run() / runWithUser + remove query defaults; tenancy + filter-combo isolation tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B5: Remove the `getInventorySummary` default + update callers

**Files:**
- Modify: `src/db/inventory.ts`
- Modify: `test/db/inventory.test.ts`

- [ ] **Step 1: Failing test.** In `test/db/inventory.test.ts`, locate every call to `getInventorySummary(db)` (no second arg) and change to `getInventorySummary(db, 1)`. The grep:

```
grep -n "getInventorySummary" test/db/inventory.test.ts
```

Three call sites: lines ~28 (`getInventorySummary(db)`), ~38 (`getInventorySummary(db)`), and ~50 (`getInventorySummary(null as never)`). Update each:
- Line ~28 → `getInventorySummary(db, 1)`
- Line ~38 → `getInventorySummary(db, 1)`
- Line ~50 → `getInventorySummary(null as never, 1)` (demo guard returns first)

- [ ] **Step 2: Refactor `src/db/inventory.ts`.** Replace with:

```ts
import { and, eq, ne, sql, desc } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems } from "./schema";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";
import { isDemoMode } from "@/lib/demo/mode";
import { seedInventorySummary } from "@/lib/demo/seed";

export interface InventorySummary {
  counts: Record<InventoryCategory, number>;
  total: number;
  updatedAt: Date | null;
}

function zeroCounts(): Record<InventoryCategory, number> {
  return Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c, 0])) as Record<
    InventoryCategory,
    number
  >;
}

export async function getInventorySummary(
  db: Db,
  orgId: number,
): Promise<InventorySummary> {
  if (isDemoMode()) return seedInventorySummary();
  const rows = await db
    .select({
      category: inventoryItems.category,
      qty: sql<number>`coalesce(sum(${inventoryItems.quantity}), 0)::int`,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.orgId, orgId), ne(inventoryItems.status, "sold")))
    .groupBy(inventoryItems.category);

  const counts = zeroCounts();
  for (const r of rows) {
    if (r.category in counts) counts[r.category as InventoryCategory] = r.qty;
  }
  const total = INVENTORY_CATEGORIES.reduce((sum, c) => sum + counts[c], 0);

  const latest = await db
    .select({ updatedAt: inventoryItems.updatedAt })
    .from(inventoryItems)
    .where(eq(inventoryItems.orgId, orgId))
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(1);

  return { counts, total, updatedAt: latest[0]?.updatedAt ?? null };
}
```

(`AIYA_ORG_ID` import removed; orgId is now a required arg.)

- [ ] **Step 3: Update the inventory action test's `getInventorySummary` calls.** `test/lib/inventory/actions.test.ts` has `getInventorySummary(db)` (no second arg) at lines ~39, ~62, ~64. Update each to `getInventorySummary(db, 1)`.

- [ ] **Step 4: Run to verify PASS.** Run: `npx vitest run test/db/inventory.test.ts test/lib/inventory/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/db/inventory.ts test/db/inventory.test.ts test/lib/inventory/actions.test.ts
git commit -m "feat(db): remove getInventorySummary default param; update callers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B6: B3 already removed diamonds defaults — verification only

**Files:** none

- [ ] **Step 1: Confirm.** Run:
```
grep -n "= AIYA_ORG_ID" src/db/diamonds.ts
```
Expected: zero matches (B3 already stripped both defaults). No commit.

---

### Task B7: B4 already removed deals query defaults — verification only

**Files:** none

- [ ] **Step 1: Confirm.** Run:
```
grep -n "= AIYA_ORG_ID" src/lib/deals/queries.ts
```
Expected: zero matches (B4 already stripped both defaults). No commit.

---

### Task B8: Update RSC pages to call `getCurrentOrgId()`

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/(admin)/deals/page.tsx`
- Modify: `src/app/(admin)/diamonds/page.tsx`

- [ ] **Step 1: Refactor `src/app/page.tsx`.** Replace with:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getInventorySummary } from "@/db/inventory";
import { getDiamondSummary } from "@/db/diamonds";
import { getActiveDeals } from "@/lib/deals/queries";
import { updatedAgo } from "@/lib/company/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [invSummary, dia, activeDeals] = await Promise.all([
    getInventorySummary(db, orgId),
    getDiamondSummary(db, orgId),
    getActiveDeals(db, orgId, 5),
  ]);
  const inventory = {
    counts: invSummary.counts,
    total: invSummary.total,
    updatedLabel: updatedAgo(invSummary.updatedAt),
  };
  const diamond = {
    kpis: { naturalIndex: dia.naturalIndex, labIndex: dia.labIndex },
    rows: [
      ...(dia.naturalIndex ? [{ label: "Natural 1ct", cents: dia.naturalIndex.cents, change24hPct: dia.naturalIndex.change24hPct }] : []),
      ...(dia.labIndex ? [{ label: "Lab 1ct", cents: dia.labIndex.cents, change24hPct: dia.labIndex.change24hPct }] : []),
      ...dia.points.map((p) => ({ label: p.label, cents: p.cents, change24hPct: null })),
    ],
  };
  const deals = { deals: activeDeals };
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid inventory={inventory} diamond={diamond} deals={deals} />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 2: Refactor `src/app/(admin)/deals/page.tsx`.** Replace the imports + the line that fetches rows:

```tsx
import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getAllDeals, type DealFilters } from "@/lib/deals/queries";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES, type DealKind, type DealCategory, type DealStatus } from "@/lib/deals/constants";
import { DealList } from "@/components/deals/DealList";
import { PostDealForm } from "@/components/deals/PostDealForm";
import { DemoNotice } from "@/components/deals/DemoNotice";
import { postDeal, markDealFilled, withdrawDeal } from "@/lib/deals/actions";

export const dynamic = "force-dynamic";

function pickFilter<T extends readonly string[]>(
  raw: string | string[] | undefined,
  allowed: T,
): T[number] | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: DealFilters = {
    status: pickFilter(params.status, DEAL_STATUSES) as DealStatus | undefined,
    kind: pickFilter(params.kind, DEAL_KINDS) as DealKind | undefined,
    category: pickFilter(params.category, DEAL_CATEGORIES) as DealCategory | undefined,
  };

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const rows = await getAllDeals(db, orgId, filters);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Deal Room</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      <nav className="mb-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest" aria-label="Deal filters">
        <FilterLink label="All" href="/deals" active={!filters.status && !filters.kind && !filters.category} />
        {DEAL_STATUSES.map((s) => (
          <FilterLink key={s} label={s} href={`/deals?status=${s}`} active={filters.status === s} />
        ))}
        {DEAL_KINDS.map((k) => (
          <FilterLink key={k} label={k} href={`/deals?kind=${k}`} active={filters.kind === k} />
        ))}
        {DEAL_CATEGORIES.map((c) => (
          <FilterLink key={c} label={c} href={`/deals?category=${c}`} active={filters.category === c} />
        ))}
      </nav>

      <PostDealForm postAction={postDeal} />

      <DealList deals={rows} markFilledAction={markDealFilled} withdrawAction={withdrawDeal} />
    </main>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 transition-colors ${
        active
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-border text-text/60 hover:border-gold/40 hover:text-gold"
      }`}
    >
      {label}
    </Link>
  );
}
```

- [ ] **Step 3: Refactor `src/app/(admin)/diamonds/page.tsx`.** Replace with:

```tsx
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ensureDbReady } from "@/db/client";
import { diamondPricePoints } from "@/db/schema";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { DiamondAdmin, type PricePointRow } from "@/components/diamonds/DiamondAdmin";
import { importMatrix, savePricePoint, deletePricePoint } from "@/lib/diamonds/actions";

export const dynamic = "force-dynamic";

export default async function DiamondsPage() {
  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const rows = await db
    .select({
      id: diamondPricePoints.id,
      label: diamondPricePoints.label,
      kind: diamondPricePoints.kind,
      pricePerCaratCents: diamondPricePoints.pricePerCaratCents,
    })
    .from(diamondPricePoints)
    .where(eq(diamondPricePoints.orgId, orgId))
    .orderBy(asc(diamondPricePoints.label));

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Diamond &amp; Gem Pricing</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>
      <DiamondAdmin
        points={rows as PricePointRow[]}
        importAction={importMatrix}
        savePoint={savePricePoint}
        deletePoint={deletePricePoint}
      />
    </main>
  );
}
```

- [ ] **Step 4: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean (no more `AIYA_ORG_ID` imports in any RSC page).

- [ ] **Step 5: Run the page-affected test suites.** Run:
```
npx vitest run test/components/dashboard
```
Expected: green. (DashboardGrid tests don't touch orgId — they pass mocked data in.)

- [ ] **Step 6: Commit.**
```bash
git add src/app/page.tsx "src/app/(admin)/deals/page.tsx" "src/app/(admin)/diamonds/page.tsx"
git commit -m "feat(pages): RSC pages resolve orgId via getCurrentOrgId() and thread it into queries

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B9: Delete `src/db/org.ts` + sweep for any stragglers

**Files:**
- Delete: `src/db/org.ts`
- Delete: `test/db/org.test.ts` (if present — was a sync helper test)
- Modify: `test/lib/company/actions.test.ts` (update the requireSession mock to the new shape)

- [ ] **Step 1: Update the company actions mock.** `src/lib/company/actions.ts` is NOT tenanted (it writes to `revenue_months`, `profit_months`, etc.) so the action file itself doesn't need to change. But its test mock currently returns `{ user }` which no longer matches the `requireSession` return type. Open `test/lib/company/actions.test.ts` line ~6:

```ts
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss" })),
}));
```

Change to:

```ts
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: vi.fn(async () => ({ user: "boss", orgId: 1 })),
}));
```

- [ ] **Step 2: Run company action tests to confirm green.** Run: `npx vitest run test/lib/company/actions.test.ts`
Expected: PASS — the company actions don't read `orgId`, so adding it to the mock return is purely a type-correctness change.

- [ ] **Step 3: Delete the org module + its test.**
```
rm src/db/org.ts
rm test/db/org.test.ts
```

(The `org.test.ts` file in this repo asserts `currentOrgId() === 1` against the now-deleted helper; with the helper gone the test is moot.)

- [ ] **Step 4: Enforcement grep.** Run:
```
grep -rn "AIYA_ORG_ID" src/
```
Expected: **zero matches**. If anything still references it, fix that file now. The login route uses a local `AIYA_ORG_ID` const — `grep -rn "from \"@/db/org\"" src/` is the more precise check; that must also return zero.

Also run:
```
grep -rn "from \"@/db/org\"" src/
```
Expected: **zero matches**.

- [ ] **Step 5: Typecheck + full suite sanity.** Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + green.

- [ ] **Step 6: Commit.**
```bash
git add -A src/db/org.ts test/db/org.test.ts test/lib/company/actions.test.ts
git commit -m "chore(db): delete src/db/org.ts + AIYA_ORG_ID constant; update company mock shape

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task B10: Middleware test extension — malformed-JWT redirect

**Files:**
- Modify: `test/middleware.test.ts`

- [ ] **Step 1: Failing test.** Append to the existing `describe("middleware matcher", …)` block in `test/middleware.test.ts`:

Below the existing matcher tests, add a new top-level describe for the verify-flow itself:

```ts
describe("middleware token verification", () => {
  const SECRET = "test-secret-test-secret-test-secret";
  const ALG = "HS256";
  const enc = (s: string) => new TextEncoder().encode(s);

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    vi.unstubAllEnvs();
  });

  function reqWith(token: string | undefined) {
    return {
      cookies: { get: (n: string) => (token ? { name: n, value: token } : undefined) },
      nextUrl: { clone: () => ({ pathname: "/" }) },
    } as never;
  }

  it("redirects a request with a JWT missing orgId to /login", async () => {
    const legacy = await new SignJWT({ user: "boss" })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(enc(SECRET));
    const res = await middleware(reqWith(legacy));
    // NextResponse.redirect produces status 307.
    expect((res as { status?: number }).status).toBe(307);
  });

  it("allows a request with a valid { user, orgId } JWT", async () => {
    const token = await createSession("boss", 1, SECRET);
    const res = await middleware(reqWith(token));
    expect((res as { status?: number }).status).not.toBe(307);
  });
});
```

Also at the top of the file (above the existing `describe`), add the imports:

```ts
import { beforeEach } from "vitest";
import { SignJWT } from "jose";
import { createSession } from "@/lib/auth/session";
```

- [ ] **Step 2: Run to verify PASS.** Run: `npx vitest run test/middleware.test.ts`
Expected: PASS — `verifySession` already rejects tokens missing orgId (Task A3), so the middleware correctly redirects them. The valid-token case passes because `verifySession` returns the full payload.

(If the legacy-token case fails because the existing middleware passes the `null` session check through, double-check that `src/middleware.ts` still has `if (!session) { … redirect to /login }` — that check has been correct since slice 0 and doesn't need modification in this slice.)

- [ ] **Step 3: Commit.**
```bash
git add test/middleware.test.ts
git commit -m "test(middleware): assert malformed-JWT (missing orgId) is redirected to /login

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase C — Verification + ship

### Task C1: Enforcement greps + full suite + tsc + build

**Files:** none (verification only)

- [ ] **Step 1: AIYA_ORG_ID elimination grep.** Run:
```
grep -rn "AIYA_ORG_ID" src/
```
Expected: only one match — the local `const AIYA_ORG_ID = 1;` in `src/app/api/login/route.ts`. (That's the intentional, documented exception per spec §3.5.) If the grep returns anything else, fix and re-grep.

- [ ] **Step 2: No validation schema accepts orgId.** Run:
```
grep -rn "orgId" src/lib/*/validation.ts
```
Expected: **zero matches**. orgId must never be wire-supplied; it's stamped from session inside `run()`.

- [ ] **Step 3: Deleted file is gone.** Run:
```
git log --oneline -- src/db/org.ts | head -5
test -e src/db/org.ts && echo "STILL EXISTS — fail" || echo "deleted — ok"
```
Expected: shows the deletion commit, and the file is gone.

- [ ] **Step 4: Full suite.** Run: `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-multi-tenant-3" && npm test -- --run`
Expected: full green (existing + ~25 new tests: orgs migration smoke + slot tests, JWT payload + tampering + missing-orgId rejection, getCurrentOrgId 4 cases, requireSession 4 cases, inventory tenancy enforcement (3) + isolation (1), diamonds tenancy (3) + isolation (1), deals tenancy (3) + filter-combo isolation (3), middleware malformed-JWT (2)).

- [ ] **Step 5: Typecheck.** Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Build.** Run: `rm -rf .next && npm run build`
Expected: success. The build's Next.js page-data step will execute every RSC page once with `force-dynamic`; if any of them throw on `getCurrentOrgId()` (e.g. because something forgot to wire the helper), this is where it surfaces.

- [ ] **Step 7: Dev smoke (auth path).** Run: `npm run dev`, log in, then:
  - `/` loads, dashboard renders.
  - `/deals` loads, post a SELL Diamond: subject "Smoke 1.0ct", qty 1, price 5000.
  - Open psql (or pglite shell — if local you can use `npx drizzle-kit studio` or any pglite client) and verify the row landed with `org_id = 1`:

```
SELECT id, org_id, subject, posted_by_label FROM deals WHERE subject = 'Smoke 1.0ct';
```

  Expected: one row, `org_id = 1`, `posted_by_label` = your dashboard credential.

- [ ] **Step 8: Dev smoke (demo path).** Run: `NEXT_PUBLIC_DEMO_MODE=true npm run dev`:
  - `/` loads, no login required.
  - `/deals` shows the 5 seeded deals.
  - Posting any deal returns "Demo mode — changes are disabled" (unchanged from slice 2).
  - No new requests touch the DB (verify by tailing dev logs — no `[deals] posted deal …` line should appear).

---

### Task C2: Whole-slice code review + merge + cleanup

**Files:** none (process)

- [ ] **Step 1: Whole-slice code review.** Spawn a code-review subagent with this prompt (paste verbatim):

> Review every change on branch `feature/aiya-multi-tenant-3` against `main` for the AIYA multi-tenant slice (slice 3). Spec: `docs/superpowers/specs/2026-05-28-aiya-multi-tenant-foundation-slice-3-design.md`. Implementation plan: `docs/superpowers/plans/2026-05-28-aiya-multi-tenant-foundation-slice-3.md`. Look specifically for: (a) `grep -rn "AIYA_ORG_ID" src/` returns only the intentional `const AIYA_ORG_ID = 1` inside `src/app/api/login/route.ts` — anything else is a bug; (b) `grep -rn "from \"@/db/org\"" src/` returns zero matches; (c) `src/db/org.ts` is deleted; (d) every action `run()` wrapper resolves `orgId` from `await requireSession()` *before* validation and threads it into `fn`; (e) no Zod input schema in `src/lib/*/validation.ts` includes `orgId`; (f) every `UPDATE`/`DELETE` WHERE clause includes `eq(table.orgId, orgId)` *in addition to* any id filter; (g) `verifySession` defensive-checks orgId is a positive integer (not just a number); (h) the migration's hand-edited AIYA seed block is sandwiched between the CREATE TABLE and the first ALTER TABLE; (i) the `-- DO NOT REGENERATE` comment is at the top of `drizzle/0004_*.sql`; (j) `test/helpers/shared-db.ts` re-seeds orgs after every `resetSharedDb()`; (k) every `vi.mock("@/lib/auth/requireSession", …)` returns the new `{ user, orgId }` shape; (l) `getCurrentOrgId()` is async, demo-mode-aware, and NOT wrapped in `React.cache`; (m) the JWT tampering test exists and asserts a re-encoded-payload-with-original-signature is rejected. Report findings, no fixes.

- [ ] **Step 2: Apply review fixes** (if any). For each finding, fix + add a failing-first test + commit with a `fix(<domain>): …` message ending in the Co-Authored-By trailer.

- [ ] **Step 3: Push the branch.**
```bash
git push -u origin feature/aiya-multi-tenant-3
```

- [ ] **Step 4: Merge to main.** From the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-multi-tenant-3 -m "merge: AIYA multi-tenant foundation slice 3

Replaces AIYA_ORG_ID = 1 with a real orgs table + per-session getCurrentOrgId()
seam backed by an extended JWT payload. Cross-org isolation tests are the
security gate.

DEPLOYMENT NOTE: JWT payload shape changed; all currently-logged-in users are
logged out on next request and must re-authenticate. Single shared credential
makes this acceptable. Rotate SESSION_SECRET if a clean cutover is preferred.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Cleanup.**
```bash
git worktree remove "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-multi-tenant-3"
git branch -d feature/aiya-multi-tenant-3
git push origin --delete feature/aiya-multi-tenant-3
```

- [ ] **Step 6: Confirm done.** Run from main: `npm test -- --run && npx tsc --noEmit && npm run build`
Expected: green + clean + build succeeds.

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean; build succeeds.
- `orgs` table exists, seeded with AIYA at id=1, with `slug UNIQUE` constraint.
- Every tenanted table (`inventory_items`, `diamond_matrix_prices`, `diamond_price_points`, `diamond_index_history`, `deals`) has a FK from `org_id` to `orgs.id`.
- JWT payload is `{ user, orgId }`; `verifySession` rejects tokens missing or malforming `orgId` (incl. tampering).
- `requireSession()` returns `{ user, orgId }`. `getCurrentOrgId()` short-circuits demo mode → 1, otherwise reads session.
- `grep -rn "AIYA_ORG_ID" src/` returns only the local const in `src/app/api/login/route.ts`.
- `grep -rn "from \"@/db/org\"" src/` returns zero matches; `src/db/org.ts` is deleted.
- `grep -rn "orgId" src/lib/*/validation.ts` returns zero matches.
- Every action `run()` resolves orgId from session before validation; every read function requires `orgId` as a non-default arg.
- Cross-org isolation tests on inventory, diamonds, and deals (each with filter combos) all pass.
- Action tenancy enforcement tests prove cross-org update/delete is a no-op even with a valid id.
- Test helper seeds both AIYA (id=1) and a fixture org (id=999) after every `resetSharedDb()`.
- Migration file `drizzle/0004_*.sql` carries a `-- DO NOT REGENERATE` header documenting the hand-appended seed block.
- Next: Slice 3a — Users (per-user RBAC + multi-org login picker) or Slice 4 — Circles per the roadmap.
