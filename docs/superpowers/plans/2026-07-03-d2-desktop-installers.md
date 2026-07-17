# D-2 — Desktop Test Installers (mac / windows / linux) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task.

**Goal:** Unsigned test installers for macOS (.dmg), Windows (NSIS .exe), Linux (.AppImage) that run the full dashboard locally — real Next server in an Electron shell, PGlite persisting to the OS user-data dir. Plus a GitHub Actions workflow as the reproducible 3-OS build path.

**Design (approved in-session):** Electron + electron-builder + `next build` standalone output. The app needs a Node server (force-dynamic RSC, server actions, PGlite) — Electron's main process spawns the standalone server via `ELECTRON_RUN_AS_NODE` and opens a window at `127.0.0.1:<port>`.

**Working directory:** `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/d2-desktop-installer`

**House rules:** exit codes via log-file + `echo "EXIT=$?"`; TDD where tests apply (D2-1); NO detached full-suite runs (controller owns it); this is INFRA — app-code changes are exactly two small, env-gated edits (D2-1) and nothing else touches `src/`.

## Pinned technical decisions (do not relitigate)

1. **Standalone is env-gated:** `output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined` in the Next config — the Netlify build path stays byte-identical.
2. **PGlite persistence:** in `src/db/client.ts`'s no-`DATABASE_URL` branch, `const dataDir = process.env.PGLITE_DATA_DIR; new PGlite(dataDir || undefined)` — undefined preserves today's in-memory behavior for tests/dev.
3. **Server spawn:** `spawn(process.execPath, [serverPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT, HOSTNAME: "127.0.0.1", ... } })` — no bundled Node needed.
4. **Static assets:** standalone output does NOT include `.next/static` or `public/` — the build script copies them to `.next/standalone/.next/static` and `.next/standalone/public` (documented Next behavior).
5. **Port:** dynamic free port by default; `IDESIGN_PORT` env override (the launch-smoke test uses it).
6. **Creds/env baked by main.js at spawn:** `DASHBOARD_USER=boss`, `DASHBOARD_PASSWORD=test-pilot-2026` (documented test creds), `SESSION_SECRET` generated once and persisted to `<userData>/session-secret` (chmod 600), `PGLITE_DATA_DIR=<userData>/pglite-data`, `NEXT_PUBLIC_DEMO_MODE` unset (live-local mode — the point is testable CRUD), `NODE_ENV=production`.
7. **Electron hygiene:** `contextIsolation: true`, `nodeIntegration: false`, empty preload, single-instance lock, child-kill on quit, mac window-all-closed convention.
8. **Icons:** skip custom icons v1 (electron-builder defaults; warning is acceptable for test builds) — note in INSTALLERS.md.
9. **Deps:** `electron` + `electron-builder` as ROOT devDependencies (latest stable — check `npm view electron version` / `npm view electron-builder version`, don't trust memory); Electron code/config lives in `desktop/` (`main.js`, `preload.js`, `electron-builder.yml`); builder invoked with `--config desktop/electron-builder.yml`.
10. **Targets:** mac dmg arm64 (Intel via CI), win nsis x64, linux AppImage x64. Artifacts → `desktop/dist/` (gitignore it).
11. **No publishing:** artifacts stay local; the CI workflow uploads run-artifacts only (no GitHub Release).

---

## Task D2-1 — Standalone gate + PGlite persistence

**Files:** the Next config (find it: `ls next.config.*`), `src/db/client.ts`, `.gitignore` (+`desktop/dist/`, `+.next/standalone` if .next isn't already ignored — check), `test/db/client.test.ts` (verify only — should stay green untouched).

Steps:
1. Read the Next config; add the env-gated `output` (decision #1). If a `nextConfig` object exists, spread carefully; keep every existing key.
2. Edit `src/db/client.ts` per decision #2 — the pglite branch only; add a 2-line comment (desktop builds persist via PGLITE_DATA_DIR; unset = in-memory, unchanged for tests/dev). Do NOT touch the neon branch or `createTestDb`.
3. Scoped verify: `npx vitest run test/db/client.test.ts` (green, untouched) + `npx tsc --noEmit` → 0.
4. Standalone build sanity: `BUILD_STANDALONE=1 npx next build > /tmp/d2-build.log 2>&1; echo "EXIT=$?"` (generous timeout — Next builds take minutes). Verify `.next/standalone/server.js` exists and `grep -c "output.*standalone" /tmp/d2-build.log || ls .next/standalone/`. Then WITHOUT the env: `npx next build` → verify `.next/standalone` is NOT regenerated (rm it first) — proving the gate.
5. Commit `feat(desktop): env-gated standalone output + PGLITE_DATA_DIR persistence (D2-1)`.

## Task D2-2 — Electron shell + builder config + deps

**Files:** create `desktop/main.js`, `desktop/preload.js`, `desktop/electron-builder.yml`, `docs/INSTALLERS.md` (draft); modify root `package.json` (devDeps + scripts).

1. `npm view electron version` + `npm view electron-builder version` → install exact-major latest as devDeps. Report versions.
2. `desktop/main.js` implementing decisions #3/#5/#6/#7:
   - Resolve `serverPath`: packaged → `path.join(process.resourcesPath, "standalone", "server.js")`; dev-run (`!app.isPackaged`) → `../.next/standalone/server.js`.
   - Free-port helper (net.createServer on 0) unless `IDESIGN_PORT`.
   - SESSION_SECRET: read `<userData>/session-secret` else `crypto.randomBytes(32).toString("hex")` + write (mode 0o600).
   - Spawn server (decision #3 env block), pipe child stdout/stderr to a log file in userData (`server.log`) for debuggability.
   - Poll `http://127.0.0.1:PORT/login` (or `/`) with net/http GET until 200/3xx (timeout 30s → dialog.showErrorBox + quit).
   - BrowserWindow 1440x900 `loadURL`. `before-quit` → child.kill(). Single-instance lock. mac activate/window-all-closed conventions.
3. `desktop/electron-builder.yml`: appId `com.idesign.commandcenter`, productName `iDesign Command Center`, `directories: { output: desktop/dist, buildResources: desktop }`, `files: ["desktop/main.js", "desktop/preload.js", "package.json"]`, `extraResources: [{ from: ".next/standalone", to: "standalone" }, { from: ".next/static", to: "standalone/.next/static" }, { from: "public", to: "standalone/public" }]` — NOTE: with extraResources doing the static/public copy, the build script does NOT need decision #4's manual copy — verify paths line up with main.js's serverPath at runtime (resourcesPath/standalone/server.js expects .next/static SIBLING inside standalone — i.e. `standalone/.next/static` ✓).
   - mac: `target: [{ target: dmg, arch: [arm64] }]`, `identity: null` (explicitly unsigned, no keychain prompts).
   - win: `target: [{ target: nsis, arch: [x64] }]`.
   - linux: `target: [{ target: AppImage, arch: [x64] }]`, category Utility.
4. Root package.json: `"main": "desktop/main.js"` (electron-builder requires it — VERIFY this doesn't confuse Next/Netlify: it doesn't, Next ignores `main`), scripts: `"desktop:build:app": "BUILD_STANDALONE=1 next build"`, `"desktop:pack:mac"/"...:win"/"...:linux": "electron-builder --config desktop/electron-builder.yml --mac|--win|--linux"`, `"desktop:build": "npm run desktop:build:app && electron-builder --config desktop/electron-builder.yml -mwl"`.
5. `docs/INSTALLERS.md` draft: build commands, artifact locations, unsigned-launch instructions (mac right-click-Open / `xattr -cr`, Windows SmartScreen "More info → Run anyway", Linux `chmod +x`), default creds `boss / test-pilot-2026`, data location per OS (userData paths), how to reset (delete pglite-data), IDESIGN_PORT override.
6. Verify: `npx tsc --noEmit` (untouched by these files but cheap), `node --check desktop/main.js` + `node --check desktop/preload.js` → syntax-valid. Commit `feat(desktop): electron shell + builder config + docs (D2-2)`.

## Task D2-3 — Build, smoke, CI workflow

1. `npm run desktop:build:app` (rebuild standalone fresh) then `npx electron-builder --config desktop/electron-builder.yml --mac 2>&1 | tee /tmp/d2-mac.log` → verify `desktop/dist/*.dmg` exists + `ls -lh`. Then `--linux` → `.AppImage`. Then `--win` → NSIS `.exe` (cross-build from macOS; if it fails on wine/mono-adjacent tooling, DON'T fight >2 attempts — record the failure, the CI workflow is the Windows path, note it in INSTALLERS.md).
2. **macOS launch smoke (required):** the built app: `IDESIGN_PORT=34567 open -W desktop/dist/mac-arm64/*.app` won't background well — instead run the binary directly: `IDESIGN_PORT=34567 "desktop/dist/mac-arm64/iDesign Command Center.app/Contents/MacOS/iDesign Command Center" > /tmp/d2-smoke.log 2>&1 &` then poll `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:34567/login` until 200 (≤60s), then `curl` the root (expect 3xx→/login or 200), then kill the process. Paste the http codes. Also verify `~/Library/Application Support/iDesign Command Center/pglite-data` was created (persistence proof) and clean it up after.
3. `.github/workflows/desktop-installers.yml`: `workflow_dispatch` trigger; matrix `os: [macos-latest, windows-latest, ubuntu-latest]`; steps: checkout, setup-node 22 + npm ci, `BUILD_STANDALONE=1 npx next build` (set the env cross-platform via `env:` block, not inline — Windows shell), per-OS electron-builder (`--mac`/`--win`/`--linux` via matrix include), `actions/upload-artifact` on `desktop/dist/*.{dmg,exe,AppImage}`. 30-min timeout per job.
4. Finalize INSTALLERS.md with actual artifact names/sizes from step 1 + the CI instructions ("Actions → Desktop installers → Run workflow → download artifacts").
5. Commit `feat(desktop): local builds + launch smoke + CI workflow (D2-3)`.

---

## Final (controller)

Full suite (app code changed only in D2-1's two gated edits — but run it), tsc, review (focus: the two src/ edits, main.js security hygiene, builder config), merge, ROADMAP/HANDOFF, hand artifact paths + launch instructions to the user.

## Done condition

- `desktop/dist/` holds a .dmg (launch-smoked), .AppImage, and .exe (or a documented CI fallback for win)
- Netlify build path provably unchanged (gate test in D2-1)
- CI workflow exists for reproducible 3-OS builds
- INSTALLERS.md tells the user exactly how to install + log in on each OS
