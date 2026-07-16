# Desktop test installers (mac / Windows / Linux)

Unsigned local test builds of iDesign Command Center that run the **real**
app — a real Next.js server (auth, server actions, live market data) inside
an Electron shell, with the local database persisting to disk between
launches. This is not the Netlify demo: it's the full read/write app, meant
for installing on a laptop and kicking the tires.

These builds are **not signed or notarized**. Each OS will complain the
first time you open one — that's expected for a test build; see "First
launch" per OS below.

## Build it

Build machine needs Node.js + npm (the same versions used for the rest of
this repo). End users of the resulting installer need nothing — Electron
bundles its own Chromium + Node runtime.

```bash
npm install                # once, or after pulling dependency changes
npm run desktop:build:app  # BUILD_STANDALONE=1 next build -> .next/standalone/
npm run desktop:pack:mac   # -> desktop/dist/*.dmg   (Apple Silicon/arm64 only; Intel Macs use the CI build)
npm run desktop:pack:win   # -> desktop/dist/*.exe   (nsis, x64)
npm run desktop:pack:linux # -> desktop/dist/*.AppImage (x64)
```

`npm run desktop:build` does the standalone build once and then packs all
three targets in one shot (`electron-builder ... -mwl`). `desktop:build:app`
must run again any time app source changes; the pack scripts alone just
repackage whatever is already in `.next/standalone`.

Cross-packing the Windows `.exe` from macOS (`desktop:pack:win`) can require
Wine locally (electron-builder shells out to Windows-only tooling — NSIS,
`rcedit` — to build the installer) and is the least reliable of the three
targets when not built on native Windows. If it fails locally, don't fight
it — the CI workflow below (or a native Windows machine) is the reliable
path for the `.exe`. The `.dmg` (built on macOS) and `.AppImage` (built on
Linux, or cross-built from macOS) don't have this issue.

Artifacts land in `desktop/dist/` (gitignored — never commit build output).

### Reproducible 3-OS builds via CI (planned, next slice)

A `workflow_dispatch` GitHub Actions workflow that builds all three targets on
their native OS (macOS, Windows, Ubuntu runners) is planned as a follow-up —
the most trustworthy Windows build path, since it actually runs on Windows
rather than cross-packaging from macOS. Not wired up yet; this section will
be filled in with the actual `Actions → ... → Run workflow` instructions once
that workflow exists.

## Logging in

Every build ships with one baked-in test credential:

| Field | Value |
| --- | --- |
| Username | `boss` |
| Password | `test-pilot-2026` |

This is intentional for a single-user local test build (see `desktop/main.js`)
— it is unrelated to and does not affect the separate Netlify deployment's
credentials (`DASHBOARD_USER`/`DASHBOARD_PASSWORD` env vars there).

## First launch (unsigned-build warnings)

### macOS

Gatekeeper blocks unsigned apps by default.

1. Mount the `.dmg` and drag the app into `/Applications` (or run it in
   place — either works).
2. **Right-click (or Control-click) the app → Open**, then confirm in the
   dialog. Opening it this way once whitelists it for future double-clicks.
   Double-clicking straight from Finder on an unsigned app just shows a
   blocking "can't be opened" alert with no way through.
3. If Gatekeeper still refuses, quarantine attributes can be stripped
   directly:
   ```bash
   xattr -cr "/Applications/iDesign Command Center.app"
   ```

### Windows

SmartScreen flags unsigned installers.

1. Run the `.exe`. SmartScreen shows "Windows protected your PC."
2. Click **More info**, then **Run anyway**.
3. Proceed through the NSIS installer normally.

### Linux

AppImages just need the executable bit set:

```bash
chmod +x "iDesign-Command-Center-*.AppImage"
./iDesign-Command-Center-*.AppImage
```

Some distros also require `libfuse2` for AppImages to mount themselves
(`sudo apt install libfuse2` on recent Ubuntu/Debian).

## Where your data lives

The app persists its local Postgres-compatible database (pglite), session
signing secret, and server logs under the OS's standard per-app data
directory (Electron's `userData` path — `desktop/main.js` pins the app name
so this location is stable across launches):

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/iDesign Command Center/` |
| Windows | `%APPDATA%\iDesign Command Center\` |
| Linux | `~/.config/iDesign Command Center/` |

Inside that folder:

- `pglite-data/` — the actual database. All inventory, deals, customers,
  watchlists, etc. live here. Persists across app restarts and reinstalls
  (it's outside the installed app bundle).
- `session-secret` — a random secret generated on first launch (owner-only
  file permissions) and reused after that so existing login sessions survive
  an app restart. Not sensitive across installs — it only signs local session
  cookies for this one install.
- `server.log` — stdout/stderr from the embedded Next.js server. Check this
  first if the app hangs on a loading screen or shows a startup-failure
  dialog.

### Resetting

- **Reset just the database** (keep your login session working, wipe all
  app data): quit the app, delete the `pglite-data` folder, relaunch. A fresh
  empty database is created and migrated automatically on next launch.
- **Full reset** (database + session secret + logs): quit the app and delete
  the entire per-OS folder listed above.

## Advanced: overriding the port

By default the app asks the OS for a free port on `127.0.0.1` at every
launch — you never need to know or care what it is. Set `IDESIGN_PORT` before
launching to pin it to a specific port instead (used by launch-smoke tests,
or if you want to hit the running server directly, e.g. `curl` against
`http://127.0.0.1:$IDESIGN_PORT/`):

```bash
IDESIGN_PORT=34567 "/Applications/iDesign Command Center.app/Contents/MacOS/iDesign Command Center"
```

## Known gaps (v1 test installers)

- **No custom app icon yet.** Packing uses electron-builder's default
  placeholder icon; you'll see a build-time warning about it, which is safe
  to ignore. Custom `.icns`/`.ico`/`.png` icons are a follow-up, not a
  blocker for testing the app itself.
- **Unsigned + unnotarized**, as covered above — expected for internal test
  builds, not appropriate for public distribution as-is.
- **Not auto-updating.** Each build is a standalone snapshot; there's no
  update-check wired up yet.
