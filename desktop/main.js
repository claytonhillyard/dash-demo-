// Electron main process for the iDesign Command Center desktop shell.
//
// This does NOT reimplement the app — it spawns the real Next.js standalone
// server (see D2-1: `BUILD_STANDALONE=1 next build`) as a child process and
// opens a BrowserWindow at http://127.0.0.1:<port>. The server is spawned via
// the Electron binary itself running in plain-Node mode (ELECTRON_RUN_AS_NODE),
// so no separate bundled Node runtime is needed.
//
// Implements the pinned decisions in
// docs/superpowers/plans/2026-07-03-d2-desktop-installers.md (#3, #5-#7).

"use strict";

const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const crypto = require("crypto");

// Pin the app name explicitly rather than relying on package.json's `name`
// ("ceo-command-center") or hoping electron-builder's `productName` config
// propagates into the packaged package.json. app.getName() (and therefore
// app.getPath("userData")'s per-OS data directory) uses this value once set,
// so this is what fixes docs/INSTALLERS.md's documented data paths in place —
// must run before app.whenReady()/requestSingleInstanceLock() below.
app.setName("iDesign Command Center");

// Shared test-installer credentials (decision #6), documented in
// docs/INSTALLERS.md. This is a local single-user test build, not a hosted
// multi-tenant deployment, so a baked-in shared credential is an accepted
// tradeoff — it is NOT how the Netlify/production path is configured.
const DASHBOARD_USER = "boss";
const DASHBOARD_PASSWORD = "test-pilot-2026";

// How long to wait for the spawned server to answer before giving up (ms).
const SERVER_READY_TIMEOUT_MS = 30_000;

let serverProcess = null;
let serverLogStream = null;
let mainWindow = null;
let currentServerUrl = null;
let isQuitting = false;

/**
 * Resolve the standalone server.js path. Packaged builds ship it under
 * extraResources (see electron-builder.yml); running main.js directly out of
 * the repo (dev) falls back to the repo's own `.next/standalone` output.
 */
function resolveServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "standalone", "server.js");
  }
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

/** Ephemeral free TCP port on loopback (decision #5's default path). */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** IDESIGN_PORT overrides the free-port default (decision #5) — used by launch-smoke tests. */
async function resolvePort() {
  const override = process.env.IDESIGN_PORT;
  if (override) {
    const parsed = Number(override);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid IDESIGN_PORT: "${override}"`);
    }
    return parsed;
  }
  return getFreePort();
}

/**
 * Per-install session signing secret (decision #6). Generated once on first
 * launch and persisted so existing session cookies keep working across
 * restarts; written 0o600 (owner read/write only). A missing/unreadable file
 * (fresh install) is the only case that generates a new one — any other read
 * error is surfaced rather than silently masked.
 *
 * Reads app.getPath("userData") itself (rather than taking it as a
 * parameter) — the path is Electron-owned, not derived from any external
 * input, so there is no path-traversal surface here.
 */
function getOrCreateSessionSecret() {
  const secretPath = path.join(app.getPath("userData"), "session-secret");
  try {
    return fs.readFileSync(secretPath, "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  }
}

/** GETs `url` until it answers 2xx/3xx, or rejects once `timeoutMs` elapses. */
function waitForServerReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const scheduleRetry = () => {
      if (Date.now() >= deadline) {
        reject(new Error(`Server did not respond at ${url} within ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 300);
    };
    // Per-attempt guard: `req.destroy()` on timeout isn't guaranteed to also
    // emit `error`, so the response, error, and timeout handlers below could
    // otherwise all fire for the same attempt. `settled` makes each attempt
    // resolve/retry exactly once no matter which handler fires first.
    const attempt = () => {
      let settled = false;
      // Plaintext HTTP is correct here, not a shortcut: `url` is always
      // http://127.0.0.1:<port>/... — our own just-spawned child process on
      // loopback, which never touches the network, so TLS has nothing to
      // protect. The same loopback URL is what mainWindow.loadURL() opens.
      const req = http.get(url, (res) => { // nosemgrep: problem-based-packs.insecure-transport.js-node.using-http-server.using-http-server
        res.resume(); // drain the body so the socket can close
        if (settled) return;
        settled = true;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else {
          scheduleRetry();
        }
      });
      req.on("error", () => {
        if (settled) return;
        settled = true;
        scheduleRetry();
      });
      req.setTimeout(2_000, () => {
        if (settled) return;
        settled = true;
        req.destroy();
        scheduleRetry();
      });
    };
    attempt();
  });
}

/** Spawns the standalone server and resolves once it's answering HTTP requests. */
async function startServer() {
  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });

  const pgliteDataDir = path.join(userDataPath, "pglite-data");
  fs.mkdirSync(pgliteDataDir, { recursive: true });

  const serverPath = resolveServerPath();
  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `Standalone server not found at ${serverPath}. Run "npm run desktop:build:app" first.`
    );
  }

  const port = await resolvePort();
  const sessionSecret = getOrCreateSessionSecret();

  const logPath = path.join(userDataPath, "server.log");
  serverLogStream = fs.createWriteStream(logPath, { flags: "a" });
  // A write-after-end (e.g. a stray buffered chunk racing killServer()'s
  // stream.end()) or disk hiccup would otherwise be an unhandled 'error'
  // event — fatal for the whole main process. This is just a debug log,
  // so swallow write errors rather than crash the app over a lost log line.
  serverLogStream.on("error", () => {});
  serverLogStream.write(`\n--- launch ${new Date().toISOString()} (port ${port}) ---\n`);

  // Decision #3: spawn via the Electron binary running as plain Node — no
  // separate bundled Node runtime required.
  serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DASHBOARD_USER,
      DASHBOARD_PASSWORD,
      SESSION_SECRET: sessionSecret,
      PGLITE_DATA_DIR: pgliteDataDir,
      // NEXT_PUBLIC_DEMO_MODE intentionally left unset: this is the real,
      // writable app against a persisted local DB, not the seeded demo.
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.pipe(serverLogStream, { end: false });
  serverProcess.stderr.pipe(serverLogStream, { end: false });

  serverProcess.on("exit", (code, signal) => {
    serverLogStream?.write(`--- server exited (code ${code}, signal ${signal}) ---\n`);
    const wasRunning = serverProcess !== null;
    serverProcess = null;
    if (!isQuitting && wasRunning && mainWindow) {
      dialog.showErrorBox(
        "iDesign Command Center stopped",
        `The background server exited unexpectedly (code ${code}). ` +
          "See server.log in the app data folder for details."
      );
    }
  });

  await waitForServerReady(`http://127.0.0.1:${port}/login`, SERVER_READY_TIMEOUT_MS);

  return `http://127.0.0.1:${port}/`;
}

function createWindow(serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadURL(serverUrl);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killServer() {
  if (serverProcess) {
    // Stop forwarding child output before ending the stream below, so a
    // buffered chunk arriving during shutdown can't race a write against an
    // already-ended writable.
    serverProcess.stdout?.unpipe(serverLogStream);
    serverProcess.stderr?.unpipe(serverLogStream);
    serverProcess.kill();
    serverProcess = null;
  }
  serverLogStream?.end();
  serverLogStream = null;
}

// Single-instance lock: a second launch focuses the existing window instead
// of spawning a second server against the same on-disk data directory.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      currentServerUrl = await startServer();
      createWindow(currentServerUrl);
    } catch (err) {
      const message = `${err && err.message ? err.message : String(err)}`;
      // Always mirror the failure to stderr — dialog.showErrorBox BLOCKS
      // until dismissed, which makes unattended runs (smoke tests, CI) hang
      // silently with zero diagnostics. IDESIGN_SMOKE=1 skips the dialog
      // entirely and exits nonzero so scripts fail fast and loud.
      console.error(`[main] startup failed: ${message}`);
      if (process.env.IDESIGN_SMOKE === "1") {
        app.exit(1);
        return;
      }
      dialog.showErrorBox(
        "iDesign Command Center failed to start",
        `${message}\n\n` +
          "See server.log in the app data folder for details."
      );
      app.quit();
    }
  });

  // mac convention: clicking the dock icon with no open windows re-shows the
  // UI against the already-running server rather than relaunching it.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && currentServerUrl) {
      createWindow(currentServerUrl);
    }
  });

  // mac convention: keep the app (and its server) alive in the dock when the
  // last window closes; every other OS quits.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    killServer();
  });
}
