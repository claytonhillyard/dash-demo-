# AIYA Netlify Demo (Simulation Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public Netlify demo of the AIYA dashboard driven by one `NEXT_PUBLIC_DEMO_MODE` flag — open access, seeded data, simulated market, disabled writes, honest banner — with no secrets or database.

**Architecture:** A single `isDemoMode()` helper gates honest short-circuits in the data-access reads, the write actions, the middleware, and the market cache fetcher; a `DemoBanner` and a login note surface it; `netlify.toml` + `@netlify/plugin-nextjs` deploy it server-rendered. With the flag unset, every existing (tested) code path runs unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle, Vitest + Testing Library, Netlify Next.js runtime.

**Spec:** `docs/superpowers/specs/2026-05-27-aiya-netlify-demo-mode-design.md`

**Conventions:** single test file: `npx vitest run <path>`. Env-flag tests use `vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true")` + `vi.unstubAllEnvs()` in `afterEach`. `isDemoMode()` reads `process.env` at call time (so stubs work per-test). Commit after every green step.

---

## Phase A — Flag, seed, reads

### Task A1: `isDemoMode()` helper

**Files:** Create `src/lib/demo/mode.ts`; Test `test/lib/demo/mode.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/demo/mode.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { isDemoMode } from "@/lib/demo/mode";

afterEach(() => vi.unstubAllEnvs());

describe("isDemoMode", () => {
  it("is false by default", () => {
    expect(isDemoMode()).toBe(false);
  });
  it("is true when NEXT_PUBLIC_DEMO_MODE === 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });
  it("is false for any other value", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    expect(isDemoMode()).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/demo/mode.test.ts`
- [ ] **Step 3: Implement.** Create `src/lib/demo/mode.ts`:

```ts
/** Public demo toggle. NEXT_PUBLIC_ so server + client read the same value. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/demo/mode.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/demo/mode.ts test/lib/demo/mode.test.ts && git commit -m "feat(demo): add isDemoMode flag helper"`

---

### Task A2: Seed data

**Files:** Create `src/lib/demo/seed.ts`; Test `test/lib/demo/seed.test.ts`

- [ ] **Step 1: Failing test.** Create `test/lib/demo/seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { seedInventorySummary, seedDiamondSummary } from "@/lib/demo/seed";
import { INVENTORY_CATEGORIES } from "@/lib/inventory/validation";

describe("demo seed", () => {
  it("inventory seed covers all 9 categories and totals correctly", () => {
    const s = seedInventorySummary();
    for (const c of INVENTORY_CATEGORIES) expect(typeof s.counts[c]).toBe("number");
    const sum = INVENTORY_CATEGORIES.reduce((n, c) => n + s.counts[c], 0);
    expect(s.total).toBe(sum);
    expect(s.updatedAt).not.toBeNull();
  });
  it("diamond seed has both indices and at least one named point", () => {
    const d = seedDiamondSummary();
    expect(d.naturalIndex?.cents).toBeGreaterThan(0);
    expect(d.labIndex?.cents).toBeGreaterThan(0);
    expect(d.points.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/demo/seed.test.ts`
- [ ] **Step 3: Implement.** Create `src/lib/demo/seed.ts`:

```ts
import type { InventorySummary } from "@/db/inventory";
import type { DiamondSummary } from "@/db/diamonds";
import { INVENTORY_CATEGORIES, type InventoryCategory } from "@/lib/inventory/validation";

const COUNTS: Record<InventoryCategory, number> = {
  Rings: 1240, Necklaces: 980, Earrings: 870, Bracelets: 620, Pendants: 450,
  Chains: 320, "Watch Bands": 150, Diamonds: 2350, Gems: 1120,
};

export function seedInventorySummary(): InventorySummary {
  const counts = { ...COUNTS };
  const total = INVENTORY_CATEGORIES.reduce((n, c) => n + counts[c], 0);
  return { counts, total, updatedAt: new Date() };
}

export function seedDiamondSummary(): DiamondSummary {
  return {
    naturalIndex: { cents: 645320, change24hPct: -0.62 },
    labIndex: { cents: 103210, change24hPct: 2.16 },
    points: [
      { label: "Pink Diamond 1ct", kind: "fancy_diamond", cents: 1265000 },
      { label: "Blue Diamond 1ct", kind: "fancy_diamond", cents: 1825000 },
      { label: "Yellow Diamond 1ct", kind: "fancy_diamond", cents: 798000 },
      { label: "Emerald (per ct)", kind: "gem", cents: 210000 },
      { label: "Sapphire (per ct)", kind: "gem", cents: 160000 },
    ],
    updatedAt: new Date(),
  };
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/demo/seed.test.ts`. Also `npx tsc --noEmit` (confirms seed shapes match `InventorySummary`/`DiamondSummary`).
- [ ] **Step 5: Commit.** `git add src/lib/demo/seed.ts test/lib/demo/seed.test.ts && git commit -m "feat(demo): mockup-matching seed for inventory + diamonds"`

---

### Task A3: `getInventorySummary` demo guard

**Files:** Modify `src/db/inventory.ts`; Test `test/db/inventory.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/db/inventory.test.ts` (top-level, after the existing `describe`):

```ts
describe("getInventorySummary demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns seeded counts without touching the db when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    // pass a db that would throw if used, proving the guard returns first
    const s = await getInventorySummary(null as never);
    expect(s.counts.Rings).toBe(1240);
    expect(s.total).toBeGreaterThan(0);
  });
});
```

(If `vi`/`afterEach` aren't already imported in this file, add them to the existing `vitest` import.)

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/db/inventory.test.ts` (guard not present → calls `.select` on null → throws).
- [ ] **Step 3: Implement.** In `src/db/inventory.ts`, add imports at the top:

```ts
import { isDemoMode } from "@/lib/demo/mode";
import { seedInventorySummary } from "@/lib/demo/seed";
```

and make `getInventorySummary` return the seed first:

```ts
export async function getInventorySummary(
  db: Db,
  orgId: number = AIYA_ORG_ID
): Promise<InventorySummary> {
  if (isDemoMode()) return seedInventorySummary();
  // ...existing query body unchanged...
```

(Leave the rest of the function exactly as-is below the guard.)

- [ ] **Step 4: Run → PASS.** `npx vitest run test/db/inventory.test.ts` (new test + existing ones; existing tests run with the flag unset so they hit the real query).
- [ ] **Step 5: Commit.** `git add src/db/inventory.ts test/db/inventory.test.ts && git commit -m "feat(demo): seed inventory summary in demo mode"`

---

### Task A4: `getDiamondSummary` demo guard

**Files:** Modify `src/db/diamonds.ts`; Test `test/db/diamonds.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/db/diamonds.test.ts`:

```ts
import { vi } from "vitest"; // add to the existing vitest import if not present

describe("getDiamondSummary demo mode", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns seeded indices without touching the db when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const s = await getDiamondSummary(null as never);
    expect(s.naturalIndex?.cents).toBeGreaterThan(0);
    expect(s.points.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/db/diamonds.test.ts`
- [ ] **Step 3: Implement.** In `src/db/diamonds.ts`, add imports:

```ts
import { isDemoMode } from "@/lib/demo/mode";
import { seedDiamondSummary } from "@/lib/demo/seed";
```

and guard `getDiamondSummary`:

```ts
export async function getDiamondSummary(db: Db, orgId: number = AIYA_ORG_ID): Promise<DiamondSummary> {
  if (isDemoMode()) return seedDiamondSummary();
  // ...existing body unchanged...
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/db/diamonds.test.ts`
- [ ] **Step 5: Commit.** `git add src/db/diamonds.ts test/db/diamonds.test.ts && git commit -m "feat(demo): seed diamond summary in demo mode"`

---

## Phase B — Writes, middleware, market, banner

### Task B1: Disable inventory writes in demo

**Files:** Modify `src/lib/inventory/actions.ts`; Test `test/lib/inventory/actions.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/lib/inventory/actions.test.ts`:

```ts
describe("inventory writes disabled in demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("createInventoryItem returns the disabled error and writes nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const res = await createInventoryItem({
      category: "Rings", name: "X", quantity: 1, status: "in_stock",
      unitCostCents: 0, retailPriceCents: 0,
    });
    expect(res).toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });
});
```

(Ensure `vi` + `afterEach` are imported in this file — they already are from the existing suite.)

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/inventory/actions.test.ts`
- [ ] **Step 3: Implement.** In `src/lib/inventory/actions.ts`:
  - add `import { isDemoMode } from "@/lib/demo/mode";`
  - at the very top of the shared `run<T>()` wrapper body (before `requireSession`), add:

```ts
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
```

(All three actions go through `run()`, so this one line covers create/update/delete.)

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/inventory/actions.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/inventory/actions.ts test/lib/inventory/actions.test.ts && git commit -m "feat(demo): disable inventory writes in demo mode"`

---

### Task B2: Disable diamond writes in demo

**Files:** Modify `src/lib/diamonds/actions.ts`; Test `test/lib/diamonds/actions.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/lib/diamonds/actions.test.ts`:

```ts
describe("diamond writes disabled in demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("importMatrix and savePricePoint return the disabled error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect(await importMatrix({ sheet: "natural", shape: "round", csv: "x" }))
      .toEqual({ ok: false, error: "Demo mode — changes are disabled" });
    expect(await savePricePoint({ label: "X", kind: "gem", pricePerCaratCents: 1 }))
      .toEqual({ ok: false, error: "Demo mode — changes are disabled" });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/diamonds/actions.test.ts`
- [ ] **Step 3: Implement.** In `src/lib/diamonds/actions.ts`:
  - add `import { isDemoMode } from "@/lib/demo/mode";`
  - at the top of the shared `run<T>()` wrapper body (before `assertSession`), add:

```ts
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
```

  - at the top of `importMatrix` (before `assertSession`), add the same line:

```ts
  if (isDemoMode()) return { ok: false, error: "Demo mode — changes are disabled" };
```

(`upsertMatrixCell`, `savePricePoint`, `deletePricePoint` go through `run()`; `importMatrix` is guarded directly.)

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/diamonds/actions.test.ts`
- [ ] **Step 5: Commit.** `git add src/lib/diamonds/actions.ts test/lib/diamonds/actions.test.ts && git commit -m "feat(demo): disable diamond writes in demo mode"`

---

### Task B3: Middleware bypass in demo

**Files:** Modify `src/middleware.ts`; Test `test/middleware.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/middleware.test.ts`:

```ts
import { vi, afterEach } from "vitest"; // add if not already imported
import { middleware } from "@/middleware";

describe("demo mode auth bypass", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("lets an unauthenticated request through when demo is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const req = { cookies: { get: () => undefined }, nextUrl: { clone: () => ({}) } } as never;
    const res = await middleware(req);
    // NextResponse.next() has no Location/redirect; redirect() would set status 307
    expect((res as { status?: number }).status).not.toBe(307);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/middleware.test.ts` (without the bypass, no session → it builds a redirect).
- [ ] **Step 3: Implement.** In `src/middleware.ts`, add `import { isDemoMode } from "@/lib/demo/mode";` and at the very top of `middleware()`:

```ts
  if (isDemoMode()) return NextResponse.next();
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/middleware.test.ts` (existing matcher tests + the new bypass test).
- [ ] **Step 5: Commit.** `git add src/middleware.ts test/middleware.test.ts && git commit -m "feat(demo): bypass auth gate in demo mode"`

---

### Task B4: Force simulated market data in demo

**Files:** Modify `src/lib/market/cache.ts`; Test `test/lib/market/cache.test.ts`

- [ ] **Step 1: Failing test.** Append to `test/lib/market/cache.test.ts`:

```ts
import { vi, afterEach } from "vitest"; // add if not present
import { defaultQuoteFetcher } from "@/lib/market/cache";

describe("demo market feed", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("forces the simulated provider for every symbol in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const quotes = await defaultQuoteFetcher();
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => q.freshness === "simulated")).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/lib/market/cache.test.ts` (`defaultQuoteFetcher` not exported yet).
- [ ] **Step 3: Implement.** In `src/lib/market/cache.ts`:
  - add imports:

```ts
import { simulatedProvider } from "./providers/simulated";
import { isDemoMode } from "@/lib/demo/mode";
```

  - add an exported fetcher and use it as the default:

```ts
/** Default poller fetcher: real provider chain, or forced-simulated in demo mode. */
export function defaultQuoteFetcher(): Promise<Quote[]> {
  return isDemoMode()
    ? resolveQuotes(ALL_SYMBOLS, [simulatedProvider])
    : resolveQuotes(ALL_SYMBOLS);
}
```

  - change the `QuoteCache` constructor default from `() => resolveQuotes(ALL_SYMBOLS)` to `defaultQuoteFetcher`:

```ts
  constructor(private fetcher: () => Promise<Quote[]> = defaultQuoteFetcher) {}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/lib/market/cache.test.ts` (existing cache tests + the new one).
- [ ] **Step 5: Commit.** `git add src/lib/market/cache.ts test/lib/market/cache.test.ts && git commit -m "feat(demo): force simulated market feed in demo mode"`

---

### Task B5: Demo banner + login note

**Files:** Create `src/components/dashboard/DemoBanner.tsx`; Modify `src/components/dashboard/Shell.tsx`; Test `test/components/dashboard/DemoBanner.test.tsx`

- [ ] **Step 1: Failing test.** Create `test/components/dashboard/DemoBanner.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/dashboard/DemoBanner";

afterEach(() => vi.unstubAllEnvs());

describe("DemoBanner", () => {
  it("renders nothing when not in demo mode", () => {
    const { container } = render(<DemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders the demo strip in demo mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    render(<DemoBanner />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/simulated data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run test/components/dashboard/DemoBanner.test.tsx`
- [ ] **Step 3: Implement.** Create `src/components/dashboard/DemoBanner.tsx`:

```tsx
import { isDemoMode } from "@/lib/demo/mode";

export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-gold/15 px-4 py-1 text-[11px] uppercase tracking-widest text-gold">
      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
      Demo Mode · simulated data
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run test/components/dashboard/DemoBanner.test.tsx`
- [ ] **Step 5: Wire into the shell.** In `src/components/dashboard/Shell.tsx`:
  - add `import { DemoBanner } from "./DemoBanner";`
  - render it at the top of the middle column, above `<TopBar>`:

```tsx
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <TopBar ticker={ticker} />
```

- [ ] **Step 6: Verify shell test still passes + tsc.** `npx vitest run test/components/Shell.test.tsx` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 7: Commit.** `git add src/components/dashboard/DemoBanner.tsx src/components/dashboard/Shell.tsx test/components/dashboard/DemoBanner.test.tsx && git commit -m "feat(demo): demo-mode banner in the shell"`

> **Scope note (spec §3 login note):** The spec mentioned a "Demo mode — no login required" note on the login page. Under the chosen open-access model the middleware bypasses auth, so visitors never land on `/login` in demo — the note would be dead UI. It is intentionally **omitted**; the shell `DemoBanner` is the single, always-visible demo indicator. (If a "Live demo" link is ever wanted on `/login`, add it in a follow-up.)

---

## Phase C — Netlify config & verification

### Task C1: Netlify config + deploy docs

**Files:** Create `netlify.toml`, `DEPLOY.md`; Modify `package.json` (devDependency)

- [ ] **Step 1: Add the Netlify Next.js runtime plugin.** Run: `npm install -D @netlify/plugin-nextjs`
Expected: it appears under `devDependencies` in `package.json` and the lockfile updates.

- [ ] **Step 2: Create `netlify.toml`:**

```toml
[build]
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

- [ ] **Step 3: Create `DEPLOY.md`:**

```markdown
# Deploying AIYA Dashboard

This is a server-rendered Next.js app (auth middleware, server actions, route
handlers, server-side reads). It is NOT a static export.

## Netlify — public demo (simulation mode)

The demo runs with no secrets and no database.

1. Connect this repo to a new Netlify site (it auto-detects `netlify.toml` and
   the `@netlify/plugin-nextjs` runtime).
2. Set environment variables:
   - `NEXT_PUBLIC_DEMO_MODE=true`
   - `SESSION_SECRET=<any long random string>` (the middleware import reads it even
     though demo bypasses auth)
   - Do **not** set `DATABASE_URL` or any API keys — demo seeds data and uses the
     simulated market feed.
3. Deploy. The dashboard is open (no login), every panel is populated with seeded
   "simulated" data, and writes are disabled with an on-screen notice.

## Netlify — real app (not the demo)

Leave `NEXT_PUBLIC_DEMO_MODE` unset and instead set `DATABASE_URL` (Neon Postgres),
`SESSION_SECRET`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, and the market API keys
(`TWELVEDATA_API_KEY`, etc.). Run `npm run db:migrate` against the Neon database
once before first use.
```

- [ ] **Step 4: Build sanity.** Run: `rm -rf .next && npm run build` → success (config doesn't break the build).
- [ ] **Step 5: Commit.** `git add netlify.toml DEPLOY.md package.json package-lock.json && git commit -m "feat(demo): netlify.toml + Next runtime plugin + DEPLOY.md"`

---

### Task C2: Full verification (demo + non-demo)

**Files:** none (verification only)

- [ ] **Step 1: Full suite (non-demo default).** Run: `npm test` → all green (the flag is unset, so every existing path runs as before plus the new demo-guard tests that stub the flag locally).
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Build.** `rm -rf .next && npm run build` → success.
- [ ] **Step 4: Demo smoke.** Run the dev server in demo mode and confirm the demo behaviors:

```bash
NEXT_PUBLIC_DEMO_MODE=true npm run dev
```
  - `/` loads **without** logging in (no redirect) and shows the demo banner + seeded Inventory Overview (Rings 1,240 …) + diamond KPIs (Natural/Lab index) + Diamonds tab rows.
  - Market KPIs all show the "simulated" freshness dot.
  - `/inventory` and `/diamonds` load; submitting a form shows "Demo mode — changes are disabled".
- [ ] **Step 5: Non-demo smoke (regression).** Stop, then `npm run dev` (flag unset) → `/` redirects to `/login` as before; logging in works; inventory/diamond admin writes work. Confirms the flag-off path is unchanged.
- [ ] **Step 6: Commit any fixes** (skip if none).

---

## Done criteria
- One `NEXT_PUBLIC_DEMO_MODE` flag drives: open access, seeded inventory + diamonds, forced-simulated market, disabled writes, demo banner.
- Flag **unset** ⇒ all existing behavior + tests unchanged; full suite + `tsc` + `next build` green.
- `netlify.toml` + `@netlify/plugin-nextjs` + `DEPLOY.md` enable a server-rendered Netlify deploy with no secrets/DB.
- Honest throughout: simulated dots + demo banner; nothing presented as live.
