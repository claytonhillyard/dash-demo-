# AIYA Slice 14 — Lighthouse CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Companion required sub-skill:** `superpowers:verification-before-completion` — every "it works" claim must be backed by a command and its output.

**Goal:** Wire `@lhci/cli@^0.15` as a devDependency, add a `lighthouserc.js` config that audits `/login` + `/` (in demo mode, no auth needed) against perf budgets matching slice 12's runtime thresholds, expose a `npm run lighthouse` script, gitignore the report directory, and document the workflow in DEPLOY.md. Zero source-file changes. Budgets calibrated from observed baseline + 10% headroom (NOT aspirational), with TODO comments naming the tightening trajectory toward slice-12's good thresholds.

**Architecture:** One new devDep (`@lhci/cli@^0.15`). One new config file at repo root (`lighthouserc.js`, CommonJS). One npm script (`lhci autorun`). One `.gitignore` entry (`.lighthouseci/`). One light test (config-shape smoke). One DEPLOY.md section. The lighthouse run happens locally; it builds, starts the app in demo mode (auth bypassed, Sentry disabled per slice 11, web-vitals reporter disabled per slice 12), audits with Chrome headless, asserts budgets, writes filesystem reports.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · `@sentry/nextjs@^8.55` (slice 11) · `web-vitals@^5.3` (slice 12) · vitest · jsdom · `@lhci/cli@^0.15` (new) · existing `isDemoMode()` seam from `src/lib/demo/mode.ts`.

---

## File Structure

**New files:**
- `lighthouserc.js` — LHCI configuration. CommonJS module exporting `{ ci: { collect, assert, upload } }`. Audits `/login` + `/` against perf/a11y/best-practices budgets in demo mode.
- `test/lighthouserc-config.test.ts` — Static-shape smoke test. Confirms the config parses, exposes the expected assertion keys, opts out of SEO, uploads to filesystem only.

**Modified files:**
- `package.json` — Add `@lhci/cli@^0.15.0` to `devDependencies`; add `"lighthouse": "lhci autorun"` to `scripts`.
- `package-lock.json` — Auto-updated by `npm install`.
- `.gitignore` — Add `.lighthouseci/` entry alongside the existing `.next/` / `.netlify` / `.playwright-mcp/` block.
- `DEPLOY.md` — Add a new "Optional: Lighthouse CI (slice 14)" section after the existing Sentry walkthrough.

**Deleted files:** None.

**Source files (`src/`):** Zero modifications. The slice is build-tooling only. The Phase B grep verifies this.

---

## Pre-flight

- [ ] **Pre-flight Step 1: Verify clean working tree on `main`.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git rev-parse HEAD
```

Expected: `## main...origin/main`. HEAD should be at or after the slice-12 merge commit. Untracked items from prior sessions (`.md2pdf.py`, `FEMALE_AI_BOT.md`, `FEMALE_AI_BOT.pdf`, `training protocol /`) are acceptable noise — leave them alone.

- [ ] **Pre-flight Step 2: Confirm test baseline is green before any edits.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
npm test -- --run 2>&1 | tail -10
```

Expected: all tests pass. Record the exact `Test Files X passed (X)` and `Tests Y passed (Y)` numbers — every later phase compares against these. **If anything fails on `main`**, stop and fix that first — slice 14's smoke test can't tell pre-existing breakage from new regression.

- [ ] **Pre-flight Step 3: Confirm slice 11 + slice 12 are in place.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
node -e 'const p = require("./package.json"); console.log("sentry:", p.dependencies["@sentry/nextjs"], "web-vitals:", p.dependencies["web-vitals"]);'
test -f sentry.client.config.ts && echo "sentry.client.config.ts present" || echo "MISSING — slice 11 not merged"
test -f src/components/observability/WebVitalsReporter.tsx && echo "WebVitalsReporter present" || echo "MISSING — slice 12 not merged"
```

Expected: a `^8.x.y` Sentry version, a `^5.x.y` web-vitals version, and both files present. If either is missing, this slice's demo-mode-isolates-observability claim is broken — STOP, this plan assumes slices 11 + 12 are on `main`.

- [ ] **Pre-flight Step 4: Confirm `@lhci/cli` is NOT already a dep.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
node -e 'const p = require("./package.json"); console.log(p.devDependencies?.["@lhci/cli"] || p.dependencies?.["@lhci/cli"] || "absent");'
```

Expected: `absent`. If a version string is printed, Task A1's install becomes a version bump — read the diff carefully before installing.

- [ ] **Pre-flight Step 5: Confirm the `lighthouserc.js` slot is empty.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
ls -la lighthouserc.* 2>/dev/null || echo "absent (good)"
```

Expected: `absent (good)`. If a file at that path exists, STOP — slice 14 was partially merged before.

- [ ] **Pre-flight Step 6: Confirm there is no `.github/` directory** (so the brief's decision to defer GitHub Actions stands).

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
ls -d .github 2>/dev/null && echo "ATTENTION: .github exists — slice 14b may be in-scope. Read brief decision 1 before proceeding." || echo "absent — slice 14 ships local-only (per brief decision 1)"
```

Expected: `absent — slice 14 ships local-only`. If `.github/` does exist with workflows, raise it with the operator before continuing — they may want a `lighthouse.yml` workflow as part of this slice.

- [ ] **Pre-flight Step 7: Confirm developer agrees to the ~150MB install cost.**

This plan's Task A1 installs `@lhci/cli`, which transitively installs Puppeteer + a Chromium binary (~150MB). The install is one-time per developer machine — `npm ci` reinstates from the npm cache after that. **If the operator wants to opt out of this cost** (e.g. they're on a constrained-disk environment), STOP this plan and discuss — the slice cannot ship without `@lhci/cli`.

```bash
df -h "$HOME" | tail -2
```

Expected: at least 1GB free in $HOME so npm cache + node_modules expansion comfortably fits.

---

## Task 0 — Worktree setup

**Files:** none (process)

- [ ] **Step 1: Create the worktree off main.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree add -b feature/aiya-lighthouse-ci-14 .worktrees/aiya-lighthouse-ci-14 main
```

Expected: a new working tree at `.worktrees/aiya-lighthouse-ci-14`, branch `feature/aiya-lighthouse-ci-14` checked out there.

- [ ] **Step 2: Switch to the worktree and install existing deps.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm install
```

Expected: `npm install` finishes clean against the existing lockfile (no new packages yet; `@lhci/cli` is added in Task A1).

- [ ] **Step 3: Baseline test run inside the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm test -- --run 2>&1 | tail -10
```

Expected: same `Test Files X passed` / `Tests Y passed` numbers as Pre-flight Step 2. Slice 14 adds exactly one new test file (~5 tests), so the final expected count is `baseline + 1` test file / `baseline + ~5` tests.

> **All subsequent `cd` commands in this plan reference the worktree path.** Use `cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"` before any command. If a step omits the `cd` for brevity, the worktree path is still implied.

---

## Phase A — Lighthouse CI wiring

### Task A1: Install `@lhci/cli@^0.15`

**Files:**
- Modify: `package.json`, `package-lock.json` (auto-updated by npm)

> **CRITICAL — One-time ~150MB install.** `@lhci/cli` transitively installs Puppeteer + a Chromium binary. The first install will be slow (~2-5 minutes on a typical connection). Subsequent `npm ci` calls hit the npm cache. If the install hangs > 10 minutes, kill it and check network — the Chromium download is the slow path.
>
> **CRITICAL — `@lhci/cli` major version.** `^0.15` allows minor/patch updates within the 0.15.x series. LHCI is pre-1.0 — its `lighthouserc.js` config shape has changed between minor versions in the past (0.12 → 0.13 was the last large shape change). If `npm` happens to install 0.16 or later, STOP and either pin `0.15.x` explicitly or update the config below to match the new shape.

- [ ] **Step 1: Install the dev dep.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm install --save-dev @lhci/cli@^0.15
```

Expected: `package.json` gains `"@lhci/cli": "^0.15.x"` in `devDependencies`. `package-lock.json` updates substantially (Puppeteer + Chromium + dozens of transitive deps). The install logs may show "Downloading Chromium" — that's normal. No peer-dep warnings should be fatal.

- [ ] **Step 2: Confirm the installed major.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
node -e 'console.log(require("@lhci/cli/package.json").version)'
```

Expected: a `0.15.x` string. If it's `0.14.*` or `0.16.*`, abort and pin `0.15.x` explicitly per the CRITICAL block above.

- [ ] **Step 3: Confirm the `lhci` binary is on the npm path.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx lhci --version
```

Expected: a version line matching the installed `@lhci/cli` version. If `npx` can't find the binary, the install failed silently — check `node_modules/.bin/lhci` exists.

- [ ] **Step 4: Confirm Chromium binary is downloaded.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
find node_modules -name 'chrome' -type f 2>/dev/null | head -3
find node_modules -name 'Chromium.app' -type d 2>/dev/null | head -3
```

Expected: at least one match for the Chrome/Chromium binary. The exact path depends on which transitive package (`puppeteer` or `chrome-launcher` or both) holds it. If neither finds anything, Chromium didn't download — the lighthouse run will fail in Task B2. Re-run `npm rebuild puppeteer` if needed.

- [ ] **Step 5: Add the npm script.**

Edit `package.json`. Locate the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate"
}
```

Add the `"lighthouse"` line as the last script entry:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "lighthouse": "lhci autorun"
}
```

- [ ] **Step 6: Confirm the npm script is wired.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm run --silent 2>&1 | grep -A1 lighthouse
```

Expected: an output line showing `lighthouse` mapped to `lhci autorun`.

- [ ] **Step 7: Commit the dep + script in one tight commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add @lhci/cli@^0.15 + npm run lighthouse (slice 14)

@lhci/cli is the build-time companion to slice 12's runtime web-vitals
reporter. Transitively installs Puppeteer + Chromium (~150MB, one-time
per developer machine). Config file + budgets land in subsequent
A-phase tasks; this commit isolates the lockfile churn so the wiring
commits stay readable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: Add `.lighthouseci/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

> **Why this commit is separate.** It's a one-line edit, but landing it before the config means the `.lighthouseci/` directory created by Task B2's lighthouse calibration run is gitignored from the moment it's first written. Reversing the order means a developer who runs Task B2 before Task A2 ends up with `.lighthouseci/` staged in their working tree.

- [ ] **Step 1: Edit `.gitignore`.**

Open `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14/.gitignore`. Append after the existing `.playwright-mcp/` block:

```
# lighthouse CI reports (slice 14)
.lighthouseci/
```

The full block around the addition should read:

```
# browser verification artifacts
.playwright-mcp/
*.jpeg
*.png

# lighthouse CI reports (slice 14)
.lighthouseci/

# misc
.DS_Store
```

- [ ] **Step 2: Confirm the entry is in place.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
grep -n "lighthouseci" .gitignore
```

Expected: one match, on a line containing `.lighthouseci/`.

- [ ] **Step 3: Commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git add .gitignore
git commit -m "$(cat <<'EOF'
chore(gitignore): ignore .lighthouseci/ reports (slice 14)

Lighthouse CI writes per-run HTML + JSON reports to .lighthouseci/.
Each run is multi-MB and machine-generated — never committed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Write `lighthouserc.js` + smoke test

**Files:**
- Create: `lighthouserc.js`
- Create: `test/lighthouserc-config.test.ts`

> **CRITICAL — Four load-bearing invariants in this config:**
>
> 1. **`NEXT_PUBLIC_DEMO_MODE=true` in `startServerCommand`.** This is the auth-bypass invariant. Without it, lighthouse cannot reach `/` because the middleware redirects to `/login`. The string must appear verbatim — the test in §5.1 greps for it.
>
> 2. **`SESSION_SECRET=lighthouse-ci-noop-secret` in `startServerCommand`.** The middleware imports `process.env.SESSION_SECRET!` (slice 11 §3.3 non-null assertion). Even though demo mode bypasses the verify path, the import-time read still happens. A real secret here would be a credential-leak; the literal dummy string is the design.
>
> 3. **`onlyCategories` excludes `"seo"`.** The dashboard isn't a marketing site — SEO assertions are noise. The smoke test verifies this exclusion explicitly.
>
> 4. **`upload.target === "filesystem"`.** Reports stay on the developer's machine. NEVER set `target: "temporary-public-storage"` (would upload dashboard screenshots to public Google storage) or `target: "lhci"` (would require a server we don't run).
>
> **CRITICAL — Budget values in this task are placeholders.** They get calibrated against real observed measurements in Task B2. Don't manually tighten them in this task — that's Task B2's job.

- [ ] **Step 1: Write the failing test.**

Create `test/lighthouserc-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

// require() works on .js CommonJS files in a vitest run; this is the same
// way @lhci/cli loads the config at runtime.
const configPath = resolve(__dirname, "..", "lighthouserc.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require(configPath) as {
  ci: {
    collect: {
      startServerCommand: string;
      startServerReadyPattern?: string;
      url: string[];
      numberOfRuns: number;
      settings: {
        preset: string;
        onlyCategories?: string[];
      };
    };
    assert: {
      assertions: Record<string, unknown>;
    };
    upload: {
      target: string;
      outputDir?: string;
    };
  };
};

describe("lighthouserc.js — shape invariants", () => {
  it("exports a CommonJS object with a `ci` key", () => {
    expect(config).toBeDefined();
    expect(config.ci).toBeDefined();
    expect(typeof config.ci).toBe("object");
  });
});

describe("lighthouserc.js — collect block", () => {
  it("audits exactly two URLs: /login and /", () => {
    expect(config.ci.collect.url).toEqual([
      "http://localhost:3000/login",
      "http://localhost:3000/",
    ]);
  });

  it("runs three samples per URL (median-of-three smooths variance)", () => {
    expect(config.ci.collect.numberOfRuns).toBe(3);
  });

  it("uses the desktop preset (slice 14 is desktop-only — see spec §2.7)", () => {
    expect(config.ci.collect.settings.preset).toBe("desktop");
  });

  it("startServerCommand sets NEXT_PUBLIC_DEMO_MODE=true (auth-bypass invariant)", () => {
    expect(config.ci.collect.startServerCommand).toContain(
      "NEXT_PUBLIC_DEMO_MODE=true",
    );
  });

  it("startServerCommand provides a literal noop SESSION_SECRET (no real credentials in CI config)", () => {
    expect(config.ci.collect.startServerCommand).toContain(
      "SESSION_SECRET=lighthouse-ci-noop-secret",
    );
  });

  it("startServerCommand boots the production server via `npm run start`", () => {
    expect(config.ci.collect.startServerCommand).toContain("npm run start");
  });
});

describe("lighthouserc.js — category opt-out", () => {
  it("opts OUT of the SEO category (not a marketing site — spec §2.4)", () => {
    expect(config.ci.collect.settings.onlyCategories).toBeDefined();
    expect(config.ci.collect.settings.onlyCategories).not.toContain("seo");
  });

  it("opts IN to performance + accessibility + best-practices", () => {
    const cats = config.ci.collect.settings.onlyCategories ?? [];
    expect(cats).toContain("performance");
    expect(cats).toContain("accessibility");
    expect(cats).toContain("best-practices");
  });
});

describe("lighthouserc.js — assertions", () => {
  it("asserts LCP (largest-contentful-paint) — matches slice 12 LCP signal", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "largest-contentful-paint",
    );
  });

  it("asserts CLS (cumulative-layout-shift) — matches slice 12 CLS signal", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "cumulative-layout-shift",
    );
  });

  it("asserts TBT (total-blocking-time) — lab proxy for slice 12 INP signal (§2.4.1)", () => {
    expect(config.ci.assert.assertions).toHaveProperty("total-blocking-time");
  });

  it("asserts performance category score", () => {
    expect(config.ci.assert.assertions).toHaveProperty("categories:performance");
  });

  it("asserts accessibility category score (slice 1c posture)", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "categories:accessibility",
    );
  });

  it("asserts best-practices category score", () => {
    expect(config.ci.assert.assertions).toHaveProperty(
      "categories:best-practices",
    );
  });

  it("does NOT assert SEO category (not a marketing site)", () => {
    expect(config.ci.assert.assertions).not.toHaveProperty("categories:seo");
  });
});

describe("lighthouserc.js — upload block", () => {
  it("uploads to the filesystem only (no public storage, no LHCI server)", () => {
    expect(config.ci.upload.target).toBe("filesystem");
  });

  it("writes reports to .lighthouseci/ (gitignored)", () => {
    expect(config.ci.upload.outputDir).toBe(".lighthouseci");
  });
});
```

- [ ] **Step 2: Run the test — expect failures (no config file yet).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx vitest run test/lighthouserc-config.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: failure citing `Cannot find module .../lighthouserc.js` (or similar). Every test in the file should error out because the require() call fails.

- [ ] **Step 3: Create `lighthouserc.js` at the repo root.**

Create `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14/lighthouserc.js`:

```js
/**
 * Lighthouse CI configuration for AIYA Dashboard.
 *
 * Slice 14 — synthetic-lab perf budgets enforced at build time. The companion
 * to slice 12's real-user Web Vitals telemetry: same thresholds, different
 * idiom. Run via `npm run lighthouse`.
 *
 * Auth: the dashboard requires login on `/`. Lighthouse runs against the
 * demo-mode build (NEXT_PUBLIC_DEMO_MODE=true), which bypasses auth entirely
 * via the slice-3 middleware short-circuit. No credentials in this file by
 * design — see spec §4 + §6.2.
 *
 * Sentry / Web Vitals: demo mode also disables Sentry init (slice 11 §6) and
 * the WebVitalsReporter observer registration (slice 12 §5), so lighthouse
 * runs produce zero synthetic events in the production observability system.
 *
 * Budgets: PLACEHOLDERS in this task. Calibrated against an observed baseline
 * in Task B2 of the plan — see spec §2.5 ("observed baseline + 10% headroom,
 * NOT aspirational"). Each assertion documents the observed value at
 * calibration time + the TODO trajectory toward slice-12 good thresholds.
 */
module.exports = {
  ci: {
    collect: {
      // Build + start in demo mode so /login AND / are reachable without auth.
      // NEXT_PUBLIC_DEMO_MODE=true also disables Sentry init (slice 11 §6),
      // so lighthouse runs don't pollute the production Sentry project.
      // SESSION_SECRET=lighthouse-ci-noop-secret is a literal dummy that
      // satisfies the middleware import — it's never used cryptographically
      // because the demo path bypasses verify (see slice 11 §3.3).
      startServerCommand:
        "NEXT_PUBLIC_DEMO_MODE=true SESSION_SECRET=lighthouse-ci-noop-secret npm run start",
      startServerReadyPattern: "Ready in",
      url: [
        "http://localhost:3000/login",
        "http://localhost:3000/",
      ],
      numberOfRuns: 3, // median of 3 — smooths out single-run variance
      settings: {
        preset: "desktop", // slice 14 is desktop-only (spec §2.7)
        // Skip SEO category — not a marketing site (spec §2.4 table)
        onlyCategories: ["performance", "accessibility", "best-practices"],
      },
    },
    assert: {
      // PLACEHOLDER BUDGETS — calibrated against observed baseline in Task B2.
      // Each TODO names the tightening trajectory toward slice-12 thresholds.
      assertions: {
        // ─── Performance vitals ──────────────────────────────────────────
        // LCP — slice 12 "good" target is 2500ms. Initial budget calibrated
        // from observed baseline + 10% headroom (Task B2 will adjust).
        // TODO(slice-14-followup): tighten toward 2500ms after perf-improvement sprint.
        "largest-contentful-paint": ["error", { maxNumericValue: 3500 }],

        // CLS — slice 12 "good" target is 0.1. Dashboard should already be
        // near-zero (no above-the-fold image swaps, no late-loading layout
        // shifts). Tight initial target; hold here.
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],

        // TBT — lab proxy for slice 12's INP runtime signal (Lighthouse 11+
        // does not emit lab INP; TBT is the documented stand-in). See spec §2.4.1.
        // TODO(slice-14-followup): tighten as we optimize main-thread work.
        "total-blocking-time": ["error", { maxNumericValue: 400 }],

        // ─── Category scores ─────────────────────────────────────────────
        // Performance — initial budget set permissively from observed baseline;
        // tighten toward ≥ 0.80 in follow-on slices.
        // TODO(slice-14-followup): tighten toward 0.80.
        "categories:performance": ["error", { minScore: 0.75 }],

        // Accessibility — slice 1c established the accessibility-conscious
        // foundation. Hold at 0.95; tighten to 1.0 in a future a11y-focused slice.
        "categories:accessibility": ["error", { minScore: 0.95 }],

        // Best Practices — generally an easy 0.9+ for a Next.js app.
        "categories:best-practices": ["error", { minScore: 0.9 }],
      },
    },
    upload: {
      // Reports written to .lighthouseci/ on the local filesystem. Gitignored.
      // No upload to LHCI server / public storage — see spec §2.2.
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
```

- [ ] **Step 4: Run the test — expect all green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx vitest run test/lighthouserc-config.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 17 tests passing (1 shape + 6 collect + 2 category opt-out + 7 assertions + 2 upload). If any fail, read the failure line — most likely a typo in either the config or the test.

- [ ] **Step 5: Typecheck (the test is TypeScript).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors. The `require()` call uses a string literal so TypeScript can't statically resolve the JS file's shape — that's fine, the test casts to an inline interface.

- [ ] **Step 6: Confirm the config also parses outside vitest (sanity check the way LHCI itself will load it).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
node -e 'const c = require("./lighthouserc.js"); console.log(JSON.stringify(c.ci.collect.url));'
```

Expected: `["http://localhost:3000/login","http://localhost:3000/"]`. If `node` throws, the config has a syntax error LHCI will also choke on.

- [ ] **Step 7: Commit the config + test.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git add lighthouserc.js test/lighthouserc-config.test.ts
git commit -m "$(cat <<'EOF'
feat(perf): lighthouserc.js with placeholder budgets + shape test (slice 14)

Audits /login and / (desktop preset, no auth — demo mode bypass) and
asserts LCP / CLS / TBT / perf-score / a11y-score / best-practices
budgets. SEO category skipped (not a marketing site). Reports written
to gitignored .lighthouseci/.

Budgets are PLACEHOLDERS — calibrated against an observed baseline in
Task B2 of the plan. Each assertion carries a TODO comment naming the
tightening trajectory toward slice-12's "good" thresholds.

The smoke test asserts the config's shape invariants — demo-mode
startServerCommand, three-run median, desktop preset, SEO opt-out,
filesystem upload only — so future edits can't accidentally regress
the security / scope properties.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Calibration + verification

### Task B1: Static verification

**Files:** none (verification only)

> **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`. Every claim of "it works" must be backed by a command and its output.

- [ ] **Step 1: Full test suite is green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm test -- --run 2>&1 | tail -10
```

Expected: `Test Files (baseline+1) passed`, `Tests (baseline+17) passed`. Zero skipped, zero failed.

- [ ] **Step 2: Typecheck is clean.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx tsc --noEmit 2>&1 | tail -10
```

Expected: zero errors, zero warnings.

- [ ] **Step 3: Build is clean (no source changes, but verify regardless).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
NEXT_PUBLIC_DEMO_MODE=true SESSION_SECRET=lighthouse-ci-noop-secret npm run build 2>&1 | tail -20
```

Expected: build succeeds. We're building in demo mode here because Task B2's lighthouse run will do the same (via `startServerCommand`). The Sentry webpack plugins log "skipped: SENTRY_AUTH_TOKEN absent" (or similar).

- [ ] **Step 4: PR-review grep checklist (slice 14 spec §6.6).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"

echo "--- grep 1: lighthouse references in src/ (should be 0 — slice adds zero source files) ---"
grep -rn "lighthouse" src/ 2>&1 | head -5 || true
echo "(end grep 1)"

echo "--- grep 2: NEXT_PUBLIC_DEMO_MODE=true in lighthouserc.js (must be at least 1) ---"
grep -n "NEXT_PUBLIC_DEMO_MODE=true" lighthouserc.js || echo "FAIL — auth-bypass invariant missing"

echo "--- grep 3: .lighthouseci in .gitignore (must be 1) ---"
grep -in "lighthouseci" .gitignore || echo "FAIL — gitignore entry missing"

echo "--- grep 4: lighthouserc.js parses ---"
node -e 'JSON.stringify(require("./lighthouserc.js"))' && echo "OK: parses" || echo "FAIL: parse error"

echo "--- grep 5: no real secrets in lighthouserc.js (only the literal noop string) ---"
grep -n "SESSION_SECRET" lighthouserc.js | grep -v "lighthouse-ci-noop-secret" && echo "FAIL — non-noop SESSION_SECRET found" || echo "OK: only noop SESSION_SECRET present"

echo "--- grep 6: no upload to public storage or remote LHCI server ---"
grep -n "temporary-public-storage\|serverBaseUrl\|lhci-server" lighthouserc.js && echo "FAIL — non-filesystem upload target detected" || echo "OK: filesystem upload only"

echo "--- grep 7: no @lhci/cli or lhci in .github/workflows/ (deferred to slice 14b) ---"
if [ -d .github/workflows ]; then
  grep -rn "lhci\|@lhci/cli\|lighthouse" .github/workflows/ && echo "ATTENTION: workflow refs found — confirm with operator" || echo "OK: no workflow refs"
else
  echo "OK: .github/workflows/ absent (per brief decision 1)"
fi
```

Expected:
- grep 1: 0 matches in `src/`. Slice 14 adds zero source files.
- grep 2: at least 1 match.
- grep 3: 1 match.
- grep 4: prints `OK: parses`.
- grep 5: prints `OK: only noop SESSION_SECRET present`.
- grep 6: prints `OK: filesystem upload only`.
- grep 7: prints `OK: .github/workflows/ absent`.

If any grep fails, STOP — read the spec §6.6 and fix before continuing.

- [ ] **Step 5: Confirm the dev server boots cleanly in demo mode.** This is the same boot LHCI will do in Task B2 — catching boot errors here gives a tighter failure surface than waiting for LHCI's harder-to-read error output.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
NEXT_PUBLIC_DEMO_MODE=true SESSION_SECRET=lighthouse-ci-noop-secret npm run start > /tmp/slice-14-server.log 2>&1 &
DEV_PID=$!
sleep 8
curl -s -o /dev/null -w "/login: %{http_code}\n" http://localhost:3000/login
curl -s -o /dev/null -w "/: %{http_code}\n" http://localhost:3000/
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
echo "--- last 20 lines of server log ---"
tail -20 /tmp/slice-14-server.log
```

Expected: HTTP 200 on `/login` and HTTP 200 on `/` (NOT a 307 redirect to /login — that would indicate demo mode didn't take effect). No errors in the server log. If `/` returns 307, the `NEXT_PUBLIC_DEMO_MODE=true` env var didn't make it through `npm run start` — check that you're using `start`, not `dev`, and that you ran `npm run build` immediately before.

---

### Task B2: First real lighthouse run + budget calibration

**Files:**
- Modify: `lighthouserc.js` (budget values only — the placeholders from Task A3)

> **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion`. The whole point of this task is verifying that the budgets land somewhere realistic.
>
> **CRITICAL — Highest-risk step in the slice.** This is the budget calibration. Spec §2.5 is the design rationale: aspirational targets fail every build forever; too-loose targets never catch regressions. The middle path is *observe first, then assert*.
>
> **CRITICAL — The lighthouse run is slow.** Expect 3-5 minutes for the full `lhci autorun`: 1 build (~45s) + 1 server boot + 6 audits (3 runs × 2 URLs × ~15-20s each) + assertion + report write. If the run exceeds 10 minutes, kill it and investigate — usually a startServerReadyPattern mismatch keeping LHCI waiting forever.

- [ ] **Step 1: Run lighthouse for the first time.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm run lighthouse 2>&1 | tee /tmp/slice-14-lighthouse-run-1.log | tail -60
```

Expected: `lhci autorun` builds, starts the server, runs 6 audits (3 × `/login` + 3 × `/`), then prints an assertion summary. The summary may show some assertions PASSING (current values within the placeholder budgets) and some FAILING (current values outside the placeholder budgets). **A failure here is EXPECTED** — the placeholders in Task A3 were not calibrated. The run output should look something like:

```
✔ npm-run-start
✔ Started a server on http://localhost:3000
Running median of 3 runs for 2 URLs...
✔ Run #1 of 3 done.
✔ Run #2 of 3 done.
✔ Run #3 of 3 done.
Done collecting.
Running 14 assertions on 2 URL(s)...

Checking assertions against 2 URL(s), 6 total run(s)

✘  http://localhost:3000/
       largest-contentful-paint failure for maxNumericValue assertion
          expected: <=3500
          found: 4123
...
```

If `lhci` errors out before running any audits, read the log — most likely cause is `startServerReadyPattern: "Ready in"` not matching Next.js's actual ready output (which has changed between Next versions). Adjust to `"started server on"` or `"- Local:"` and rerun.

- [ ] **Step 2: Read the observed values.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
# Find the report JSONs from the run.
ls -lah .lighthouseci/ | tail -10

# Extract the key metrics from one representative report — pick whichever JSON
# corresponds to the `/` audit (the heavier page is the binding constraint).
# The exact filename depends on the run hash; ls .lighthouseci/ to find it.
node <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const dir = ".lighthouseci";
const files = fs.readdirSync(dir).filter(f => f.startsWith("lhr-") && f.endsWith(".json"));
console.log("Reports found:", files.length);
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const url = r.finalDisplayedUrl || r.finalUrl;
  const audits = r.audits;
  const cats = r.categories;
  console.log(`\n=== ${url} ===`);
  console.log(`  LCP:  ${audits["largest-contentful-paint"]?.numericValue?.toFixed(0)}ms`);
  console.log(`  CLS:  ${audits["cumulative-layout-shift"]?.numericValue?.toFixed(3)}`);
  console.log(`  TBT:  ${audits["total-blocking-time"]?.numericValue?.toFixed(0)}ms`);
  console.log(`  Perf score:        ${(cats.performance?.score * 100).toFixed(0)}`);
  console.log(`  A11y score:        ${(cats.accessibility?.score * 100).toFixed(0)}`);
  console.log(`  Best-practices:    ${(cats["best-practices"]?.score * 100).toFixed(0)}`);
}
EOF
```

Expected: a clean dump of the median (or per-run) metrics for both `/login` and `/`. Record these — they're the inputs for budget calibration.

- [ ] **Step 3: Calibrate the budgets.**

For each metric, the rule from spec §2.5 is:

- **Metrics with reasonable variance** (LCP, TBT, Performance score): budget = `observed × 1.1` rounded to a clean number (so a normal-variance bad day doesn't fail CI).
- **Metrics that should be near-zero** (CLS): budget = `0.1` (the slice 12 "good" threshold). If the observed value is already above 0.1, that's a bug to file, not a budget to slacken. Document it in the commit message and open a follow-up.
- **A11y + Best Practices scores**: hold at the spec defaults (0.95 and 0.90 respectively). If observed is below these, that's a bug to fix in this slice or file as a follow-up.

Edit `lighthouserc.js`. Replace each assertion's `maxNumericValue` / `minScore` with the calibrated value. **Update the comment on each assertion** to record the observed median + calibration date. Example, if observed LCP on `/` is 3200ms:

```js
        // LCP — observed 2026-06-05: /login 1100ms, / 3200ms.
        // Budget set at 3500 (=3200×1.1 rounded). Slice 12 "good" target is 2500.
        // TODO(slice-14-followup): tighten toward 2500 after perf-improvement sprint.
        "largest-contentful-paint": ["error", { maxNumericValue: 3500 }],
```

> **CRITICAL — Document the actual observed numbers in the comment, not the placeholder values.** A future reader needs to know whether the budget is loose because we observed slow today, or because someone copy-pasted a placeholder.

> **CRITICAL — If observed CLS exceeds 0.1**, this is a slice-12 / slice-1c regression — do NOT widen the budget to hide it. STOP and either fix the cause (likely a late-loading image without dimensions, or a font swap layout shift) or file a follow-up bug and document the bug ID in the comment. The whole point of slice 14 is to catch this kind of thing; widening the budget defeats the purpose.

- [ ] **Step 4: Run lighthouse a second time to confirm the calibrated budgets pass.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm run lighthouse 2>&1 | tee /tmp/slice-14-lighthouse-run-2.log | tail -30
```

Expected: every assertion passes. `lhci autorun` exits 0. The summary should read something like `Passed: 12/12` (or however many assertions are configured).

If any still fail after calibration, you didn't observe correctly in Step 2 OR a metric is genuinely unstable run-to-run (LCP can vary 10-20% on noisy hardware). In that case, widen the headroom from `× 1.1` to `× 1.25` and re-run once more.

- [ ] **Step 5: Confirm the calibrated test still passes the shape test.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npx vitest run test/lighthouserc-config.test.ts 2>&1 | tail -10
```

Expected: 17 tests passing — the shape assertions don't pin specific budget values, so calibration doesn't break the test.

- [ ] **Step 6: Confirm full test suite is still green.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm test -- --run 2>&1 | tail -10
```

Expected: same `baseline + 17 tests` count as Task B1 Step 1.

- [ ] **Step 7: Commit the calibration.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git add lighthouserc.js
git commit -m "$(cat <<'EOF'
perf(slice-14): calibrate Lighthouse budgets from observed baseline

Ran `npm run lighthouse` against the current main build. Set each budget
to observed × 1.1 (LCP / TBT / perf-score) or held at slice-12 good
thresholds (CLS). Each assertion comment records the observed median
and calibration date.

These are intentionally permissive — the first slice 14 ship should
PASS, not fail. The TODO(slice-14-followup) markers name the tightening
trajectory toward slice-12 good thresholds (LCP 2500ms, perf 0.80).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Documentation

### Task C1: DEPLOY.md walkthrough

**Files:**
- Modify: `DEPLOY.md`

> **Goal:** Help the next developer (or the operator coming back to this repo in a month) run lighthouse, interpret a failure, and understand the budget trajectory. Mirror the slice 11 Sentry walkthrough's tone — turnkey, honest about the install cost, explicit about what's NOT enforced.

- [ ] **Step 1: Read the current DEPLOY.md to find the Sentry section.**

Open `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14/DEPLOY.md`. The Sentry section ("## Sentry setup (optional, real-app only)") starts around line 28 and ends around line 64. The new section goes immediately after it.

- [ ] **Step 2: Append the Lighthouse CI section.**

Add this block to the end of `DEPLOY.md` (after the existing Sentry CSP-note paragraph):

```markdown

## Lighthouse CI (slice 14) — optional perf budget gate

Slice 14 wires `@lhci/cli` to enforce performance budgets at build time. It's
the synthetic-lab companion to slice 12's real-user Web Vitals telemetry:
**same thresholds, but checked in a Chrome lab before the code ships.** When
the dashboard's LCP or interaction responsiveness regresses, the developer
catches it locally instead of the user catching it in production.

### Install cost note

`@lhci/cli` is a heavy devDependency — it transitively installs Puppeteer and
a Chromium binary (~150MB). The first `npm install` after pulling this slice
takes 2-5 minutes longer than usual. Subsequent `npm ci` calls reinstate from
the npm cache. If disk space is a concern, `npm uninstall --save-dev @lhci/cli`
is safe — it disables the `npm run lighthouse` script but no runtime behavior
depends on it.

### Running locally

```bash
npm run lighthouse
```

This runs `lhci autorun` (configured by `lighthouserc.js`), which:

1. Runs `npm run build` (production build).
2. Starts the app via `npm run start` with `NEXT_PUBLIC_DEMO_MODE=true`
   (no auth required, no Sentry init, no live providers — see slice 11 §6 +
   slice 12 §5).
3. Audits `/login` and `/` with Chrome headless, three runs per URL (median).
4. Writes HTML + JSON reports to `.lighthouseci/` (gitignored).
5. Exits non-zero if any budget is violated.

Expect 3-5 minutes per invocation (build + boot + 6 audits + reporting).

### Interpreting a failure

When a budget fails, the console output looks like:

```
✘  http://localhost:3000/
       largest-contentful-paint failure for maxNumericValue assertion
          expected: <=3500
          found: 4123
```

To see the full report, open the HTML version in your browser:

```bash
open .lighthouseci/lhr-*.html
```

(if multiple runs are present, `ls .lighthouseci/` first to find the most
recent timestamp). The HTML report includes per-audit waterfalls, screenshots,
and improvement suggestions.

### Budgets + the tightening trajectory

Initial budgets in `lighthouserc.js` were calibrated from observed baseline +
10% headroom on the date the slice merged (see each assertion's inline
comment for the observed median and calibration date). They are intentionally
permissive — the goal of slice 14's initial ship is to land the gate, not to
demand perfection.

Each assertion carries a `TODO(slice-14-followup)` comment naming the
trajectory toward slice-12's "good" thresholds:
- LCP — tighten toward 2500ms (slice 12 "good")
- TBT — tighten as main-thread work is optimized
- Performance score — tighten toward 0.80
- CLS — already at slice-12 good (0.1); hold
- Accessibility — hold at 0.95 (slice 1c posture); a future a11y slice may
  tighten to 1.0
- Best Practices — hold at 0.90

When a perf-improvement slice lands, that slice's commit should also tighten
the corresponding budget in `lighthouserc.js`. This keeps the budget a
*ratchet*, not a target.

### What's NOT enforced

The slice ships local-only. The following are explicit follow-ups (see slice
14 design doc §8):

- **LHCI server upload (per-PR perf diffs)** — would require running an LHCI
  server. Reports stay on disk for now.
- **GitHub Actions / Netlify build-time enforcement** — slice 14b candidate.
  The current repo has no `.github/workflows/`; once it does, a one-job
  workflow can run `npm run lighthouse` and fail the PR check on a budget
  violation.
- **Per-page budgets for `/inventory`, `/diamonds`, `/deals`, `/website`** —
  slice 14c candidate. Today we audit `/` (the heaviest page) as the binding
  constraint and `/login` as a baseline; per-page budgets are added once those
  pages settle.
- **Mobile audits** — deferred; the dashboard is desktop-first. A future
  mobile-design slice will add `preset: "mobile"` to the config.

### Security note

`lighthouserc.js` contains the literal dummy string
`SESSION_SECRET=lighthouse-ci-noop-secret` to satisfy the middleware's
import-time `process.env.SESSION_SECRET!` read. This is **not a real
secret** — the demo path bypasses verify, so the value is never used
cryptographically. The literal-noop string makes the source obvious in
process listings and audit logs.

The `.lighthouseci/` report directory contains screenshots of the audited
pages. Since we audit in demo mode, the screenshots show seeded demo data —
no real org names, no real customer data. If a future developer adds
non-demo URLs to the audit, they'd need to reconsider whether the screenshots
are safe to keep on disk.
```

- [ ] **Step 3: Confirm the section landed correctly.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
grep -n "Lighthouse CI" DEPLOY.md
grep -n "npm run lighthouse" DEPLOY.md
```

Expected: at least one match for `Lighthouse CI` and at least one for `npm run lighthouse`. The grep should find the heading + the code block usage.

- [ ] **Step 4: Word-count sanity check.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
wc -l DEPLOY.md
```

Expected: ~130-150 lines (the file was 64 lines before; adding ~70-90 lines of Lighthouse documentation puts it in range). If it's > 200 lines, the section is too verbose — trim. If it's < 100, the section is missing parts — re-check Step 2.

- [ ] **Step 5: Commit.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git add DEPLOY.md
git commit -m "$(cat <<'EOF'
docs(deploy): document Lighthouse CI usage + budget trajectory (slice 14)

DEPLOY.md gets a new optional section after the Sentry walkthrough.
Covers the install cost (~150MB Puppeteer + Chromium), how to run
locally, how to read a failure, the budget calibration philosophy
(observed × 1.1 — NOT aspirational), and what's explicitly deferred
to slice 14b/c. Mirrors the slice 11 Sentry walkthrough's tone.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Merge

### Task D1: Final review + merge to `main`

**Files:** none (process)

> **REQUIRED SUB-SKILL:** Use `superpowers:finishing-a-development-branch` to decide between fast-forward merge, PR, or further cleanup. For solo-operator work on `main`, no-fast-forward merge is the established pattern (see slice 10/11/12 merge commits).

- [ ] **Step 1: Confirm working tree is clean inside the worktree.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git status -sb
```

Expected: `## feature/aiya-lighthouse-ci-14` with no untracked, modified, or staged files. The `.lighthouseci/` directory should NOT show up (it's gitignored as of Task A2). If it does, the gitignore entry didn't land correctly — re-do Task A2.

- [ ] **Step 2: Review the commits.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
git log main..HEAD --oneline
git diff main..HEAD --stat
```

Expected: five commits matching Tasks A1, A2, A3, B2, C1:
1. `chore(deps): add @lhci/cli@^0.15 + npm run lighthouse`
2. `chore(gitignore): ignore .lighthouseci/ reports`
3. `feat(perf): lighthouserc.js with placeholder budgets + shape test`
4. `perf(slice-14): calibrate Lighthouse budgets from observed baseline`
5. `docs(deploy): document Lighthouse CI usage + budget trajectory`

The `--stat` should show roughly: `package.json | 4 +-`, `package-lock.json | many lines`, `.gitignore | 3 +`, `lighthouserc.js | ~60 lines new`, `test/lighthouserc-config.test.ts | ~100 lines new`, `DEPLOY.md | ~80 lines added`.

- [ ] **Step 3: Final whole-slice grep verification (spec §6.6 exit gate).**

Re-run the seven greps from Task B1 Step 4 one more time. All should still pass.

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"

echo "Exit gate — slice 14 §6.6 checks:"
grep -rn "lighthouse" src/ 2>&1 | head -1 || true
grep -n "NEXT_PUBLIC_DEMO_MODE=true" lighthouserc.js
grep -in "lighthouseci" .gitignore
node -e 'JSON.stringify(require("./lighthouserc.js"))' && echo "config: parses"
grep -n "SESSION_SECRET" lighthouserc.js | grep -v "lighthouse-ci-noop-secret" && echo "FAIL" || echo "OK: no non-noop SESSION_SECRET"
grep -n "temporary-public-storage\|serverBaseUrl" lighthouserc.js && echo "FAIL" || echo "OK: filesystem-only upload"
[ -d .github/workflows ] && grep -rn "lhci" .github/workflows/ || echo "OK: no .github workflow"
```

Expected: each line either OK or 0-match. If anything fails, STOP — fix it before merging.

- [ ] **Step 4: Run lighthouse one more time, just to confirm budgets still pass on the calibrated config.** (Belt-and-suspenders before merge.)

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm run lighthouse 2>&1 | tail -15
```

Expected: `Passed: N/N` (all assertions). Exit code 0. If any assertion fails, the calibration in Task B2 wasn't tight enough — widen the relevant budget(s) by another 10%, re-commit, and re-run.

- [ ] **Step 5: Run the full test suite one more time on the worktree branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/aiya-lighthouse-ci-14"
npm test -- --run 2>&1 | tail -10
```

Expected: same `baseline + 17` count as before.

- [ ] **Step 6: Decide merge shape (no-fast-forward, matching the slice 10/11/12 pattern).**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git checkout main
git merge --no-ff feature/aiya-lighthouse-ci-14 -m "$(cat <<'EOF'
Merge slice 14: Lighthouse CI

Adds @lhci/cli@^0.15 as a devDependency and a `npm run lighthouse`
script that audits /login + / against perf budgets matching slice
12's runtime thresholds. Runs in demo mode (NEXT_PUBLIC_DEMO_MODE=true)
— auth bypassed, Sentry disabled, no synthetic events in production.
Reports written to gitignored .lighthouseci/.

Initial budgets calibrated from observed baseline + 10% headroom
(NOT aspirational). Each assertion's TODO comment names the trajectory
toward slice-12 good thresholds.

Zero source-file changes. ~60-line config + ~30-line shape test +
~80-line DEPLOY.md walkthrough.

CI integration (slice 14b), per-page budgets (slice 14c), mobile audits,
and LHCI server upload are explicit follow-ups — see slice 14 design §8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: clean no-conflict merge. Slice 14 only adds files (and modifies `package.json` / `.gitignore` / `DEPLOY.md`) — no source files touched, so the conflict surface with other slices is minimal.

- [ ] **Step 7: Run the full test suite ONE MORE TIME on `main` after the merge.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
npm test -- --run 2>&1 | tail -10
```

Expected: same `baseline + 17` count as Task B1 Step 1. Zero regressions.

- [ ] **Step 8: Remove the worktree + branch.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git worktree remove .worktrees/aiya-lighthouse-ci-14
git branch -d feature/aiya-lighthouse-ci-14
```

Expected: clean removal. If `git branch -d` complains the branch isn't fully merged, you skipped Step 6 — re-run.

- [ ] **Step 9: Confirm `main` is clean + slice 14 is shipped.**

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git status -sb
git log -8 --oneline
```

Expected: `## main` clean, top commit is the slice 14 merge.

---

## Done

When all checkboxes in this plan are checked:

- `@lhci/cli@^0.15` is in `devDependencies`.
- `npm run lighthouse` runs `lhci autorun` against `/login` + `/` in demo mode and asserts the calibrated budgets.
- `lighthouserc.js` at the repo root carries each assertion's observed-baseline calibration date and TODO trajectory toward slice-12 good thresholds.
- `.lighthouseci/` is gitignored.
- `DEPLOY.md` has a new "Lighthouse CI" optional section with run instructions, failure interpretation, budget philosophy, and explicit follow-ups.
- `test/lighthouserc-config.test.ts` enforces the config's shape invariants: demo-mode startServerCommand, no real secrets, no public-storage upload, SEO opt-out, expected assertion keys.
- All slice 11 invariants (Sentry init no-op in demo) + slice 12 invariants (no web-vital events in demo) are preserved by composition — a lighthouse run produces zero events in production observability systems.
- Zero source files modified.

The operator can now run `npm run lighthouse` locally to catch perf regressions before they ship. The companion slice 12 catches whatever slips through, on real users in production. Future slices (14b GitHub Actions integration, 14c per-page budgets, mobile audits) build on top of this foundation.
