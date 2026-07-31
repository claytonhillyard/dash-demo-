# Slice C-7 — Hardening Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Three independent chips; no design ambiguity — this plan IS the spec.

**Goal:** Convert three accumulated review chips into shipped, tested fixes. No migration, no deps, no behavior change to happy paths.

**Working directory for every command:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-c7-hardening`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; node_modules installed; TDD failing-first; NO detached full-suite runs; shared-db harness; NEVER write the literal `@vitest-environment` string in prose comments; a silent exit-1 may be the flapping host sandbox — retry before believing it.

---

## Task C7-1 — `__setTestDb` production no-op guard

**Problem (chip):** 14 "use server" action files export `__setTestDb(d)` — a test seam that sets a module-global `testDb`. Because "use server" exports are POST-invokable server actions, an authenticated user could call `__setTestDb` with garbage and poison `db()` for the whole server instance until restart (null resets harmlessly; any object breaks it).

**The 14 files:** `src/lib/` → `customers/actions.ts`, `customers/import/actions.ts`, `drafting/actions.ts`, `payments/actions.ts`, `invoices/actions.ts`, `invoices/import/actions.ts`, `circles/actions.ts`, `website/actions.ts`, `diamonds/actions.ts`, `deals/actions.ts`, `inventory/actions.ts`, `watchlists/actions.ts`, `command/actions.ts`, `company/actions.ts`. Each has `export async function __setTestDb(d: Db | null): Promise<void> { testDb = d; }` (confirm each — a couple may name the param `db`).

**Fix:** guard the body so it no-ops outside test. Vitest sets `process.env.VITEST` and `NODE_ENV==="test"`. Use a shared guard, but DO NOT create a new shared "use server" import (that changes the module graph); the simplest safe form in EACH file:
```ts
export async function __setTestDb(d: Db | null): Promise<void> {
  // Test seam only. "use server" exports are POST-invokable; outside the
  // test runner this must do nothing so it can't poison db() in prod
  // (review chip). VITEST is set by the vitest runner; NODE_ENV==="test"
  // covers other harnesses.
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) return;
  testDb = d;
}
```
Apply to all 14 verbatim (adapt the param name where it's `db`). Verify the seam still WORKS in tests (every `test/lib/**/actions.test.ts` that calls `__setTestDb` in beforeAll must stay green — that's the proof the guard doesn't break the test path).

**New test:** `test/lib/actions-test-seam-guard.test.ts` — a node-env test that, with `vi.stubEnv("NODE_ENV","production")` + `vi.stubEnv("VITEST","")` (unset), imports one action module's `__setTestDb`, calls it with a sentinel fake db, then asserts a subsequent action still used the REAL `getDb()` path (i.e. the sentinel was ignored). Simplest observable: call `__setTestDb(sentinel)` under prod env, then assert calling it did NOT change behavior — e.g. spy that `db()` still returns the real client. Implementer's judgment on the cleanest observable; if a direct observable is awkward, at minimum assert the function resolves without setting the global by re-importing and checking an action errors the same way with/without the sentinel. Keep it to ONE representative module.

Verify: the new test + a representative existing actions test (e.g. `test/lib/payments/actions.test.ts`) still green + tsc. Commit `fix(actions): no-op __setTestDb outside the test env (C-7)`.

## Task C7-2 — Dashboard per-panel fetch degradation

**Problem (chip):** `src/app/page.tsx` fetches all panel data in `Promise.all`; any one reader throwing fails the ENTIRE dashboard render (no try/catch anywhere). One flaky panel = a dead dashboard.

**Fix:** wrap each independent panel fetch so a throw degrades to a safe empty value AND is Sentry-captured (degradation must NOT be silent). Add a local helper in page.tsx:
```ts
async function safePanel<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; }
  catch (e) {
    Sentry.captureException(e, { tags: { area: "dashboard-panel", panel: label } });
    return fallback;
  }
}
```
Wrap each entry in the FIRST `Promise.all` (the panel-data one, lines ~59-77) with `safePanel("<name>", getX(...), <correct-empty-fallback>)`. The fallback MUST match each reader's return type — read each reader's signature and use its genuine empty shape (arrays → `[]`; summary objects → the same zero-object the reader returns when empty; trend arrays → `[]`). Do NOT guess shapes — open each reader. Leave the per-deal SECOND Promise.all as-is for THIS task UNLESS a deal fetch failing is trivially wrappable the same way (implementer's judgment; if the per-deal shapes are Map-derived and fiddly, scope this task to the first block and note it). The downstream compute (e.g. computeRunway over `[]`, computeReceivablesAging over `[]`) must already handle empties — verify (slice 33 made them robust to empty).

**Tests:** `test/app/dashboard-degradation.test.tsx` (demo RSC harness or a direct unit of the assembly if extractable) — mock ONE reader (e.g. `getReceivablesRows`) to reject; assert the page still renders (renderToString succeeds, other panels present) AND `Sentry.captureException` was called with the panel tag (mocked-Sentry-to-globalThis pattern). If page-level mocking of a single reader is too coarse, extract the `safePanel` helper to a tiny testable module and unit-test it directly (rejects→fallback+capture; resolves→passthrough) + one integration assertion. Note the approach chosen.

Verify: the new test + `test/app/` dashboard/home tests still green + tsc. Commit `fix(dashboard): degrade a failing panel fetch instead of 500ing the page (C-7)`.

## Task C7-3 — Tailwind `text` color token  (CONTROLLER does this — not a subagent task)

Handled on the main thread with a preview screenshot check. (Add `text: "hsl(var(--text))"` to `tailwind.config.ts` colors; rebuild; confirm `text-text/*` classes compile + eyeball a couple pages.)

---

## Final verification (controller)

After C7-1 + C7-2 subagents land and C7-3 is done: full suite detached, `npx tsc --noEmit`, `npx next build`. Adversarial review probes: the guard actually blocks the prod path but preserves the test path (all actions tests green is the proof); the degradation fallbacks match reader shapes AND downstream compute survives them; Sentry-capture on degradation is present (not silent); the Tailwind change is additive (no other token altered) and doesn't break any existing `text-*` utility. Apply fixes → merge --no-ff → ROADMAP C-7 shipped + HANDOFF → clean up `.worktrees/slice-35b-write-commands` + branch → dismiss the two resolved chips.

## Done condition

- C7-1 + C7-2 commits + the C7-3 config change + docs; no migration; no deps
- Full suite green; tsc clean; next build clean; `text-text/*` classes now compile; a failing panel no longer 500s the dashboard; `__setTestDb` is a prod no-op
