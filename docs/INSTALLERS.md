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
npm run desktop:pack:mac   # -> desktop/dist/*.dmg   (Intel/x64 — see arch note below)
npm run desktop:pack:win   # -> desktop/dist/*.exe   (NSIS, x64)
npm run desktop:pack:linux # -> desktop/dist/*.AppImage (x64)
```

`npm run desktop:build` does the standalone build once and then packs all
three targets in one shot (`electron-builder ... -mwl`). `desktop:build:app`
must run again any time app source changes; the pack scripts alone just
repackage whatever is already in `.next/standalone`.

All three targets verifiably cross-build from macOS (D2-3 built and shipped
all three locally, no Wine needed for the Windows NSIS target with
electron-builder 26). Reference build (v0.1.0, built + smoke-tested on an
Intel Mac, macOS 13):

| Artifact | Size | Verified |
|---|---|---|
| `iDesign Command Center-0.1.0.dmg` (mac x64) | ~260 MB | installed app launch-smoked: serves login in ~8s, persists data |
| `iDesign Command Center Setup 0.1.0.exe` (win x64 NSIS) | ~210 MB | built + structure-verified; runtime testing needs a Windows machine |
| `iDesign Command Center-0.1.0.AppImage` (linux x64) | ~249 MB | built + structure-verified; runtime testing needs a Linux machine |

**Mac architecture note:** the local pack targets **x64** (Intel) because the
dev machine is an Intel Mac and an unrunnable arm64 binary can't be
smoke-tested there. Apple-silicon DMGs come from the CI workflow, whose mac
job builds **both** arches.

**Electron version note:** pinned to `electron@35` (devDependency). Electron
43 was tried first and hangs during framework init on Intel + macOS 13
(before any app code runs — newer Electron majors have raised their macOS
floor). Bump the major only after verifying launch on the oldest mac you
still test on.

Artifacts land in `desktop/dist/` (gitignored — never commit build output).

### Reproducible 3-OS builds via CI

`.github/workflows/desktop-installers.yml` builds all three targets on their
native OS. GitHub → **Actions** → **Desktop installers** → **Run workflow**,
wait for the three matrix jobs, then download the per-OS artifacts
(`idesign-command-center-mac-dmg` / `-windows-exe` / `-linux-appimage`) from
the run page. The mac job produces both Intel and Apple-silicon DMGs.

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
