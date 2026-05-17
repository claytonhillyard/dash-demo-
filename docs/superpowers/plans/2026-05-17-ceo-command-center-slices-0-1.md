# CEO Command Center — Slices #0 + #1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable Next.js dashboard shell with a full design system, deep settings, an auth gate, and live market data flowing through a hybrid keyless+keyed provider layer with honest freshness labeling.

**Architecture:** Next.js App Router on Vercel. Route handlers act as a backend-for-frontend so API keys stay server-side. A single in-process poller refreshes per-asset-class caches; clients revalidate a cached `/api/quotes` endpoint via selector-subscribed hooks so a tick re-renders only the affected cell. Providers sit behind one normalized `Quote` interface with an ordered failover router.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand (settings + quote store), Vitest + React Testing Library, TradingView Lightweight Charts, `jose` (signed session cookie). Providers: CoinGecko & Frankfurter (keyless), Finnhub & Twelve Data (free key).

**Spec:** `docs/superpowers/specs/2026-05-17-ceo-command-center-design.md`

---

## File Structure

```
package.json                         deps + scripts
next.config.mjs                      next config
tsconfig.json                        TS config (path alias @/*)
tailwind.config.ts                   Nocturnal Gold tokens
postcss.config.mjs
vitest.config.ts                     test runner + jsdom
.env.example                         documents required env vars
src/
  app/
    layout.tsx                       root layout: fonts + providers
    globals.css                      tailwind layers + CSS vars
    page.tsx                         protected dashboard
    login/page.tsx                   credential login
    api/quotes/route.ts              BFF: reads server cache
    api/login/route.ts               sets signed session cookie
  middleware.ts                      auth gate (redirect to /login)
  lib/
    auth/session.ts                  sign/verify session JWT
    market/types.ts                  Quote, AssetClass, Freshness, provider iface
    market/registry.ts               symbol -> {assetClass, display, currency}
    market/freshness.ts              compute Freshness
    market/providers/coingecko.ts
    market/providers/frankfurter.ts
    market/providers/finnhub.ts
    market/providers/twelvedata.ts
    market/providers/simulated.ts
    market/router.ts                 class -> ordered providers + failover + budget
    market/cache.ts                  in-memory cache + single poller
  components/
    Panel.tsx                        panel primitive (all states + freshness dot)
    FreshnessDot.tsx
    dashboard/Shell.tsx              grid + nav + topbar + rail + footer
    dashboard/Nav.tsx
    dashboard/TopBar.tsx
    dashboard/RightRail.tsx
    dashboard/FooterBar.tsx
    dashboard/SettingsPanel.tsx
    market/TickerStrip.tsx
    market/MarketAnalysisPanel.tsx
    market/TopStocksTable.tsx
    market/MiniCards.tsx
    market/Sparkline.tsx
  store/
    settings.ts                      Zustand settings store (persisted)
    quotes.ts                        Zustand quote store (selector subs)
  hooks/
    useSetting.ts
    useQuotesPoll.ts
test/                                mirrors src/ where logic is tested
```

---

# PHASE A — Slice #0: Foundation

## Task A1: Project scaffold

**Files:**
- Create: `package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ceo-command-center",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "zustand": "5.0.2",
    "jose": "5.9.6",
    "lightweight-charts": "4.2.1"
  },
  "devDependencies": {
    "@testing-library/react": "16.1.0",
    "@testing-library/jest-dom": "6.6.3",
    "@types/node": "22.10.1",
    "@types/react": "19.0.1",
    "@types/react-dom": "19.0.1",
    "@vitejs/plugin-react": "4.3.4",
    "autoprefixer": "10.4.20",
    "jsdom": "25.0.1",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.16",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create config files**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, setupFiles: ["./test/setup.ts"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```

`.env.example`:
```
SESSION_SECRET=change-me-to-a-long-random-string
DASHBOARD_USER=boss
DASHBOARD_PASSWORD=change-me
FINNHUB_API_KEY=
TWELVEDATA_API_KEY=
```

- [ ] **Step 3: Create `test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Create base app files**

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: 220 26% 6%;
  --surface: 222 24% 9%;
  --gold: 41 78% 64%;
  --teal: 168 64% 52%;
  --text: 210 20% 90%;
  --gold-intensity: 0.8;
}
[data-amoled="true"] { --bg: 0 0% 0%; --surface: 0 0% 4%; }
[data-reduce-motion="true"] * { animation: none !important; transition: none !important; }
html, body { background: hsl(var(--bg)); color: hsl(var(--text)); }
```

`src/app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Orbitron } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-display" });

export const metadata = { title: "CEO Command Center" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${orbitron.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
export default function Home() {
  return <main data-testid="dashboard-root">CEO Command Center</main>;
}
```

- [ ] **Step 5: Install and verify build**

Run: `npm install && npm run build`
Expected: build completes with no errors; route `/` compiled.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with tooling and fonts"
```

## Task A2: Tailwind Nocturnal Gold tokens

**Files:**
- Create: `tailwind.config.ts`
- Test: `test/tailwind.test.ts`

- [ ] **Step 1: Write the failing test**

`test/tailwind.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import config from "../tailwind.config";

describe("tailwind tokens", () => {
  it("exposes nocturnal palette", () => {
    const colors = config.theme?.extend?.colors as Record<string, unknown>;
    expect(colors).toHaveProperty("gold");
    expect(colors).toHaveProperty("teal");
    expect(colors).toHaveProperty("surface");
  });
  it("scans src for classes", () => {
    expect(config.content).toContain("./src/**/*.{ts,tsx}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/tailwind.test.ts`
Expected: FAIL — cannot find module `../tailwind.config`.

- [ ] **Step 3: Create `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        surface: "hsl(var(--surface))",
        gold: "hsl(var(--gold))",
        teal: "hsl(var(--teal))",
        ok: "hsl(142 60% 45%)",
        warn: "hsl(41 90% 55%)",
        bad: "hsl(0 70% 55%)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        display: ["var(--font-display)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/tailwind.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts test/tailwind.test.ts
git commit -m "feat: add Nocturnal Gold design tokens"
```

## Task A3: Settings store + `useSetting`

**Files:**
- Create: `src/store/settings.ts`, `src/hooks/useSetting.ts`
- Test: `test/store/settings.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSettings, DEFAULT_SETTINGS } from "@/store/settings";

describe("settings store", () => {
  beforeEach(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS } }));

  it("has sane defaults", () => {
    const s = useSettings.getState().settings;
    expect(s.density).toBe("comfortable");
    expect(s.refreshSeconds).toBe(15);
    expect(s.amoled).toBe(false);
    expect(s.reduceMotion).toBe(false);
  });

  it("updates a single key without touching others", () => {
    useSettings.getState().set("amoled", true);
    const s = useSettings.getState().settings;
    expect(s.amoled).toBe(true);
    expect(s.density).toBe("comfortable");
  });

  it("clamps refreshSeconds to >= 5", () => {
    useSettings.getState().set("refreshSeconds", 1);
    expect(useSettings.getState().settings.refreshSeconds).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/store/settings.test.ts`
Expected: FAIL — cannot find module `@/store/settings`.

- [ ] **Step 3: Implement the store**

`src/store/settings.ts`:
```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Density = "compact" | "comfortable";
export interface Settings {
  amoled: boolean;
  reduceMotion: boolean;
  goldIntensity: number; // 0..1
  uiScale: number;       // 0.8..1.25
  density: Density;
  refreshSeconds: number;
  hiddenPanels: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  amoled: false,
  reduceMotion: false,
  goldIntensity: 0.8,
  uiScale: 1,
  density: "comfortable",
  refreshSeconds: 15,
  hiddenPanels: [],
};

interface SettingsState {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export const useSettings = create<SettingsState>()(
  persist(
    (setState) => ({
      settings: { ...DEFAULT_SETTINGS },
      set: (key, value) =>
        setState((state) => {
          const next = { ...state.settings, [key]: value };
          if (key === "refreshSeconds") next.refreshSeconds = clamp(next.refreshSeconds, 5, 600);
          if (key === "uiScale") next.uiScale = clamp(next.uiScale, 0.8, 1.25);
          if (key === "goldIntensity") next.goldIntensity = clamp(next.goldIntensity, 0, 1);
          return { settings: next };
        }),
    }),
    { name: "ccc-settings" }
  )
);
```

`src/hooks/useSetting.ts`:
```ts
import { useSettings, type Settings } from "@/store/settings";

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSettings((s) => s.settings[key]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/store/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/settings.ts src/hooks/useSetting.ts test/store/settings.test.ts
git commit -m "feat: persisted settings store with clamping"
```

## Task A4: Auth session + login + middleware gate

**Files:**
- Create: `src/lib/auth/session.ts`, `src/app/api/login/route.ts`, `src/app/login/page.tsx`, `src/middleware.ts`
- Test: `test/lib/auth/session.test.ts`

- [ ] **Step 1: Write the failing test**

`test/lib/auth/session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  const secret = "test-secret-test-secret-test-secret";

  it("round-trips a valid token", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token, secret)).toEqual({ user: "boss" });
  });

  it("rejects a tampered token", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token + "x", secret)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await createSession("boss", secret);
    expect(await verifySession(token, "another-secret-another-secret")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/auth/session.test.ts`
Expected: FAIL — cannot find module `@/lib/auth/session`.

- [ ] **Step 3: Implement session helpers**

`src/lib/auth/session.ts`:
```ts
import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const enc = (s: string) => new TextEncoder().encode(s);

export async function createSession(user: string, secret: string): Promise<string> {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(enc(secret));
}

export async function verifySession(
  token: string,
  secret: string
): Promise<{ user: string } | null> {
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: [ALG] });
    return typeof payload.user === "string" ? { user: payload.user } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/auth/session.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement login route, login page, middleware**

`src/app/api/login/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const { user, password } = await req.json();
  if (user !== process.env.DASHBOARD_USER || password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = await createSession(user, process.env.SESSION_SECRET!);
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

`src/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    if (res.ok) router.replace("/");
    else setError(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={submit} className="w-80 space-y-3 rounded-lg bg-surface p-6">
        <h1 className="font-display text-gold text-xl tracking-widest">CHILLY.AI</h1>
        <input aria-label="user" className="w-full bg-bg p-2" value={user}
          onChange={(e) => setUser(e.target.value)} />
        <input aria-label="password" type="password" className="w-full bg-bg p-2"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-bad text-sm" role="alert">Invalid credentials</p>}
        <button className="w-full bg-gold p-2 text-black" type="submit">Enter</button>
      </form>
    </main>
  );
}
```

`src/middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/session";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/quotes"] };
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds; middleware and routes compile.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: signed-cookie auth gate with login"
```

## Task A5: FreshnessDot + Panel primitive

**Files:**
- Create: `src/components/FreshnessDot.tsx`, `src/components/Panel.tsx`
- Test: `test/components/Panel.test.tsx`

- [ ] **Step 1: Write the failing test**

`test/components/Panel.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel } from "@/components/Panel";

describe("Panel", () => {
  it("renders title and children when ready", () => {
    render(<Panel title="Revenue" state="ready"><span>$23M</span></Panel>);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("$23M")).toBeInTheDocument();
  });

  it("shows a not-wired placeholder, never fake numbers", () => {
    render(<Panel title="Work Orders" state="unwired" />);
    expect(screen.getByText(/not yet wired/i)).toBeInTheDocument();
  });

  it("shows an error message in error state", () => {
    render(<Panel title="Crypto" state="error" errorMessage="boom" />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders a freshness dot when freshness given", () => {
    render(<Panel title="BTC" state="ready" freshness="simulated"><i/></Panel>);
    expect(screen.getByTestId("freshness-dot")).toHaveAttribute(
      "data-freshness", "simulated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/components/Panel.test.tsx`
Expected: FAIL — cannot find module `@/components/Panel`.

- [ ] **Step 3: Implement components**

`src/components/FreshnessDot.tsx`:
```tsx
export type Freshness = "live" | "delayed" | "stale" | "simulated";

const COLOR: Record<Freshness, string> = {
  live: "bg-ok",
  delayed: "bg-warn",
  stale: "bg-bad/60",
  simulated: "bg-transparent ring-1 ring-text/50",
};

export function FreshnessDot({ freshness }: { freshness: Freshness }) {
  return (
    <span
      data-testid="freshness-dot"
      data-freshness={freshness}
      title={freshness}
      className={`inline-block h-2 w-2 rounded-full ${COLOR[freshness]}`}
    />
  );
}
```

`src/components/Panel.tsx`:
```tsx
import type { ReactNode } from "react";
import { FreshnessDot, type Freshness } from "./FreshnessDot";

export type PanelState = "loading" | "ready" | "empty" | "error" | "unwired";

export function Panel({
  title, state, children, freshness, errorMessage,
}: {
  title: string;
  state: PanelState;
  children?: ReactNode;
  freshness?: Freshness;
  errorMessage?: string;
}) {
  return (
    <section className="rounded-lg bg-surface p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-text/70">{title}</h3>
        {freshness && <FreshnessDot freshness={freshness} />}
      </header>
      {state === "loading" && <div className="animate-pulse text-text/40">Loading…</div>}
      {state === "ready" && children}
      {state === "empty" && <div className="text-text/40">No data</div>}
      {state === "error" && <div className="text-bad text-sm">{errorMessage}</div>}
      {state === "unwired" && (
        <div className="text-text/30 text-sm italic">Not yet wired — future slice</div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/components/Panel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/FreshnessDot.tsx src/components/Panel.tsx test/components/Panel.test.tsx
git commit -m "feat: Panel primitive with honest states + freshness dot"
```

## Task A6: Shell, Nav, TopBar, RightRail, FooterBar, SettingsPanel

**Files:**
- Create: `src/components/dashboard/Shell.tsx`, `Nav.tsx`, `TopBar.tsx`, `RightRail.tsx`, `FooterBar.tsx`, `SettingsPanel.tsx`
- Modify: `src/app/page.tsx`
- Test: `test/components/Shell.test.tsx`

- [ ] **Step 1: Write the failing test**

`test/components/Shell.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "@/components/dashboard/Shell";

describe("Shell", () => {
  it("renders nav, wordmark, and a content slot", () => {
    render(<Shell><div data-testid="slot">x</div></Shell>);
    expect(screen.getByText("CHILLY.AI")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByTestId("slot")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/components/Shell.test.tsx`
Expected: FAIL — cannot find module `@/components/dashboard/Shell`.

- [ ] **Step 3: Implement shell pieces**

`src/components/dashboard/Nav.tsx`:
```tsx
const SECTIONS = [
  "Dashboard", "Market Analysis", "Company Overview", "Clients", "Staff",
  "Work Orders", "Maintenance", "Calendar", "Financial Overview",
  "AI & Automation", "Security Center", "Settings",
];
export function Nav() {
  return (
    <nav className="w-48 shrink-0 space-y-1 bg-surface p-3" aria-label="Primary">
      {SECTIONS.map((s) => (
        <div key={s} className="cursor-default rounded px-2 py-1 text-sm text-text/70
          hover:text-gold">{s}</div>
      ))}
    </nav>
  );
}
```

`src/components/dashboard/TopBar.tsx`:
```tsx
import type { ReactNode } from "react";
export function TopBar({ ticker }: { ticker?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 bg-surface px-4 py-2">
      <span className="font-display text-gold text-lg tracking-widest">CHILLY.AI</span>
      <span className="text-text/60 text-sm">CEO Command Center</span>
      <div className="ml-auto flex items-center gap-4">{ticker}</div>
    </header>
  );
}
```

`src/components/dashboard/RightRail.tsx`:
```tsx
import type { ReactNode } from "react";
export function RightRail({ children }: { children?: ReactNode }) {
  return <aside className="w-64 shrink-0 space-y-3 bg-surface p-3">{children}</aside>;
}
```

`src/components/dashboard/FooterBar.tsx`:
```tsx
export function FooterBar() {
  return (
    <footer className="flex items-center gap-6 bg-surface px-4 py-1 text-xs text-text/50">
      <span>EMPIRE PROTOCOL</span>
      <span>AES-256</span>
      <span className="ml-auto">Session active</span>
    </footer>
  );
}
```

`src/components/dashboard/SettingsPanel.tsx`:
```tsx
"use client";
import { useSettings } from "@/store/settings";
import { Panel } from "@/components/Panel";

export function SettingsPanel() {
  const { settings, set } = useSettings();
  return (
    <Panel title="Theme & Display" state="ready">
      <label className="flex items-center justify-between py-1 text-sm">
        AMOLED
        <input type="checkbox" checked={settings.amoled}
          onChange={(e) => set("amoled", e.target.checked)} />
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Reduce motion
        <input type="checkbox" checked={settings.reduceMotion}
          onChange={(e) => set("reduceMotion", e.target.checked)} />
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Density
        <select value={settings.density}
          onChange={(e) => set("density", e.target.value as "compact" | "comfortable")}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label className="flex items-center justify-between py-1 text-sm">
        Refresh (s)
        <input type="number" min={5} value={settings.refreshSeconds}
          onChange={(e) => set("refreshSeconds", Number(e.target.value))} />
      </label>
    </Panel>
  );
}
```

`src/components/dashboard/Shell.tsx`:
```tsx
"use client";
import { type ReactNode, useEffect } from "react";
import { useSettings } from "@/store/settings";
import { Nav } from "./Nav";
import { TopBar } from "./TopBar";
import { RightRail } from "./RightRail";
import { FooterBar } from "./FooterBar";
import { SettingsPanel } from "./SettingsPanel";

export function Shell({ children, ticker }: { children: ReactNode; ticker?: ReactNode }) {
  const { amoled, reduceMotion } = useSettings((s) => s.settings);
  useEffect(() => {
    document.documentElement.dataset.amoled = String(amoled);
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [amoled, reduceMotion]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar ticker={ticker} />
      <div className="flex flex-1">
        <Nav />
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <RightRail><SettingsPanel /></RightRail>
      </div>
      <FooterBar />
    </div>
  );
}
```

- [ ] **Step 4: Wire `src/app/page.tsx`**

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";

export default function Home() {
  return (
    <Shell>
      <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
        <Panel title="Company Overview" state="unwired" />
        <Panel title="Revenue Projections" state="unwired" />
        <Panel title="Work Orders" state="unwired" />
        <Panel title="Client Satisfaction" state="unwired" />
      </div>
    </Shell>
  );
}
```

- [ ] **Step 5: Run test + build**

Run: `npm run test -- test/components/Shell.test.tsx && npm run build`
Expected: test PASS (1 test); build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: dashboard shell with nav, settings panel, honest placeholders"
```

## Task A7: Phase A manual verification

- [ ] **Step 1: Run dev server and verify the foundation**

Run: `npm run dev`
Then in a browser at `http://localhost:3000`:
- Visiting `/` redirects to `/login` (auth gate works).
- Logging in with `.env` `DASHBOARD_USER`/`DASHBOARD_PASSWORD` lands on the dashboard.
- Nav, top bar with CHILLY.AI wordmark (Orbitron), footer render.
- Settings panel toggles: AMOLED visibly changes background; Reduce motion sets the data attribute; Density/Refresh persist across reload (localStorage).
- All data panels show "Not yet wired" — no fake numbers anywhere.

- [ ] **Step 2: Commit any fixes, then tag the slice**

```bash
git add -A && git commit -m "chore: phase A verification fixes" --allow-empty
git tag slice-0-foundation
```

---

# PHASE B — Slice #1: Live Market Data

## Task B1: Market types + symbol registry + freshness

**Files:**
- Create: `src/lib/market/types.ts`, `src/lib/market/registry.ts`, `src/lib/market/freshness.ts`
- Test: `test/lib/market/freshness.test.ts`, `test/lib/market/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/lib/market/registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { lookup, ALL_SYMBOLS } from "@/lib/market/registry";

describe("registry", () => {
  it("classifies known symbols", () => {
    expect(lookup("AAPL")?.assetClass).toBe("equity");
    expect(lookup("BTC")?.assetClass).toBe("crypto");
    expect(lookup("EURUSD")?.assetClass).toBe("fx");
    expect(lookup("SPX")?.assetClass).toBe("index");
    expect(lookup("XAU")?.assetClass).toBe("commodity");
  });
  it("returns undefined for unknown", () => {
    expect(lookup("NOPE")).toBeUndefined();
  });
  it("exports a non-empty symbol list", () => {
    expect(ALL_SYMBOLS.length).toBeGreaterThan(10);
  });
});
```

`test/lib/market/freshness.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeFreshness } from "@/lib/market/freshness";

describe("computeFreshness", () => {
  const now = Date.UTC(2026, 4, 17, 12, 0, 0);
  it("simulated source is always simulated", () => {
    expect(computeFreshness("simulated", now, now)).toBe("simulated");
  });
  it("recent real data is live", () => {
    expect(computeFreshness("finnhub", now - 5_000, now)).toBe("live");
  });
  it("older real data is delayed", () => {
    expect(computeFreshness("finnhub", now - 120_000, now)).toBe("delayed");
  });
  it("very old real data is stale", () => {
    expect(computeFreshness("finnhub", now - 30 * 60_000, now)).toBe("stale");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/lib/market`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types, registry, freshness**

`src/lib/market/types.ts`:
```ts
export type AssetClass = "equity" | "crypto" | "fx" | "index" | "commodity" | "bond";
export type ProviderId =
  | "finnhub" | "twelvedata" | "coingecko" | "frankfurter" | "simulated";
export type Freshness = "live" | "delayed" | "stale" | "simulated";

export interface SymbolDef {
  symbol: string;
  assetClass: AssetClass;
  display: string;
  currency: string;
}

export interface Quote {
  symbol: string;
  assetClass: AssetClass;
  display: string;
  price: number;
  changeAbs: number;
  changePct: number;
  currency: string;
  asOf: number;       // epoch ms
  source: ProviderId;
  freshness: Freshness;
}

export interface RawQuote {
  price: number;
  changeAbs: number;
  changePct: number;
  asOf: number;
}

export interface QuoteProvider {
  id: ProviderId;
  supports(assetClass: AssetClass): boolean;
  fetchQuotes(symbols: SymbolDef[]): Promise<Map<string, RawQuote>>;
}
```

`src/lib/market/registry.ts`:
```ts
import type { SymbolDef } from "./types";

export const ALL_SYMBOLS: SymbolDef[] = [
  { symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD" },
  { symbol: "MSFT", assetClass: "equity", display: "Microsoft Corp.", currency: "USD" },
  { symbol: "NVDA", assetClass: "equity", display: "NVIDIA Corp.", currency: "USD" },
  { symbol: "GOOGL", assetClass: "equity", display: "Alphabet Inc.", currency: "USD" },
  { symbol: "AMZN", assetClass: "equity", display: "Amazon.com", currency: "USD" },
  { symbol: "TSLA", assetClass: "equity", display: "Tesla Inc.", currency: "USD" },
  { symbol: "META", assetClass: "equity", display: "Meta Platforms", currency: "USD" },
  { symbol: "BTC", assetClass: "crypto", display: "Bitcoin", currency: "USD" },
  { symbol: "ETH", assetClass: "crypto", display: "Ethereum", currency: "USD" },
  { symbol: "SOL", assetClass: "crypto", display: "Solana", currency: "USD" },
  { symbol: "EURUSD", assetClass: "fx", display: "EUR/USD", currency: "USD" },
  { symbol: "GBPUSD", assetClass: "fx", display: "GBP/USD", currency: "USD" },
  { symbol: "SPX", assetClass: "index", display: "S&P 500", currency: "USD" },
  { symbol: "NDX", assetClass: "index", display: "NASDAQ 100", currency: "USD" },
  { symbol: "DJI", assetClass: "index", display: "Dow Jones", currency: "USD" },
  { symbol: "VIX", assetClass: "index", display: "VIX", currency: "USD" },
  { symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD" },
  { symbol: "XAG", assetClass: "commodity", display: "Silver", currency: "USD" },
];

const BY_SYMBOL = new Map(ALL_SYMBOLS.map((s) => [s.symbol, s]));
export function lookup(symbol: string): SymbolDef | undefined {
  return BY_SYMBOL.get(symbol);
}
```

`src/lib/market/freshness.ts`:
```ts
import type { Freshness, ProviderId } from "./types";

export function computeFreshness(
  source: ProviderId,
  asOf: number,
  now: number = Date.now()
): Freshness {
  if (source === "simulated") return "simulated";
  const ageMs = now - asOf;
  if (ageMs <= 30_000) return "live";
  if (ageMs <= 5 * 60_000) return "delayed";
  return "stale";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/lib/market`
Expected: PASS (registry 3, freshness 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/types.ts src/lib/market/registry.ts src/lib/market/freshness.ts test/lib/market
git commit -m "feat: market types, symbol registry, freshness rules"
```

## Task B2: Simulated provider (fallback of last resort)

**Files:**
- Create: `src/lib/market/providers/simulated.ts`
- Test: `test/lib/market/providers/simulated.test.ts`

- [ ] **Step 1: Write the failing test**

`test/lib/market/providers/simulated.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { simulatedProvider } from "@/lib/market/providers/simulated";
import { ALL_SYMBOLS } from "@/lib/market/registry";

describe("simulatedProvider", () => {
  it("supports every asset class", () => {
    for (const c of ["equity","crypto","fx","index","commodity","bond"] as const) {
      expect(simulatedProvider.supports(c)).toBe(true);
    }
  });
  it("returns a deterministic-shaped quote for each symbol", async () => {
    const out = await simulatedProvider.fetchQuotes(ALL_SYMBOLS.slice(0, 3));
    expect(out.size).toBe(3);
    const q = out.get("AAPL")!;
    expect(q.price).toBeGreaterThan(0);
    expect(typeof q.changePct).toBe("number");
    expect(q.asOf).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/market/providers/simulated.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the simulated provider**

`src/lib/market/providers/simulated.ts`:
```ts
import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

function seeded(symbol: string): number {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 10 + 10; // 10..110 base price
}

export const simulatedProvider: QuoteProvider = {
  id: "simulated",
  supports: () => true,
  async fetchQuotes(symbols: SymbolDef[]) {
    const now = Date.now();
    const out = new Map<string, RawQuote>();
    for (const s of symbols) {
      const base = seeded(s.symbol);
      const drift = Math.sin(now / 60_000 + base) * base * 0.01;
      const price = +(base + drift).toFixed(2);
      const changeAbs = +drift.toFixed(2);
      out.set(s.symbol, {
        price,
        changeAbs,
        changePct: +((changeAbs / base) * 100).toFixed(2),
        asOf: now,
      });
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/market/providers/simulated.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/providers/simulated.ts test/lib/market/providers/simulated.test.ts
git commit -m "feat: simulated provider for graceful degradation"
```

## Task B3: CoinGecko provider (keyless crypto)

**Files:**
- Create: `src/lib/market/providers/coingecko.ts`
- Test: `test/lib/market/providers/coingecko.test.ts`

- [ ] **Step 1: Write the failing test**

`test/lib/market/providers/coingecko.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { coingeckoProvider } from "@/lib/market/providers/coingecko";

const SYMS = [
  { symbol: "BTC", assetClass: "crypto" as const, display: "Bitcoin", currency: "USD" },
];

describe("coingeckoProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("only supports crypto", () => {
    expect(coingeckoProvider.supports("crypto")).toBe(true);
    expect(coingeckoProvider.supports("equity")).toBe(false);
  });

  it("maps the API response into RawQuote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 67842, usd_24h_change: 2.35 },
    }))));
    const out = await coingeckoProvider.fetchQuotes(SYMS);
    const q = out.get("BTC")!;
    expect(q.price).toBe(67842);
    expect(q.changePct).toBeCloseTo(2.35);
  });

  it("returns an empty map on HTTP error (router will fail over)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const out = await coingeckoProvider.fetchQuotes(SYMS);
    expect(out.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/market/providers/coingecko.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the provider**

`src/lib/market/providers/coingecko.ts`:
```ts
import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

const ID_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana",
};

export const coingeckoProvider: QuoteProvider = {
  id: "coingecko",
  supports: (c) => c === "crypto",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const ids = symbols.map((s) => ID_MAP[s.symbol]).filter(Boolean);
    if (ids.length === 0) return out;
    const url =
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}` +
      `&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return out;
    const data = (await res.json()) as Record<
      string, { usd: number; usd_24h_change: number }
    >;
    const now = Date.now();
    for (const s of symbols) {
      const row = data[ID_MAP[s.symbol]];
      if (!row) continue;
      const pct = row.usd_24h_change ?? 0;
      out.set(s.symbol, {
        price: row.usd,
        changePct: +pct.toFixed(2),
        changeAbs: +((row.usd * pct) / 100).toFixed(2),
        asOf: now,
      });
    }
    return out;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/market/providers/coingecko.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/providers/coingecko.ts test/lib/market/providers/coingecko.test.ts
git commit -m "feat: keyless CoinGecko crypto provider"
```

## Task B4: Frankfurter (keyless fx), Finnhub & Twelve Data (keyed)

**Files:**
- Create: `src/lib/market/providers/frankfurter.ts`, `finnhub.ts`, `twelvedata.ts`
- Test: `test/lib/market/providers/frankfurter.test.ts`, `finnhub.test.ts`, `twelvedata.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/lib/market/providers/frankfurter.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { frankfurterProvider } from "@/lib/market/providers/frankfurter";
const SYMS = [{ symbol: "EURUSD", assetClass: "fx" as const, display: "EUR/USD", currency: "USD" }];
describe("frankfurterProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports only fx", () => {
    expect(frankfurterProvider.supports("fx")).toBe(true);
    expect(frankfurterProvider.supports("crypto")).toBe(false);
  });
  it("maps latest rate to RawQuote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      rates: { USD: 1.0856 },
    }))));
    const out = await frankfurterProvider.fetchQuotes(SYMS);
    expect(out.get("EURUSD")!.price).toBeCloseTo(1.0856);
  });
});
```

`test/lib/market/providers/finnhub.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { finnhubProvider } from "@/lib/market/providers/finnhub";
const SYMS = [{ symbol: "AAPL", assetClass: "equity" as const, display: "Apple", currency: "USD" }];
describe("finnhubProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports equity and fx", () => {
    expect(finnhubProvider.supports("equity")).toBe(true);
    expect(finnhubProvider.supports("commodity")).toBe(false);
  });
  it("maps /quote response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      c: 195.84, d: 2.17, dp: 1.12,
    }))));
    const out = await finnhubProvider.fetchQuotes(SYMS);
    const q = out.get("AAPL")!;
    expect(q.price).toBe(195.84);
    expect(q.changePct).toBeCloseTo(1.12);
  });
  it("returns empty on missing key", async () => {
    delete process.env.FINNHUB_API_KEY;
    const out = await finnhubProvider.fetchQuotes(SYMS);
    expect(out.size).toBe(0);
  });
});
```

`test/lib/market/providers/twelvedata.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { twelvedataProvider } from "@/lib/market/providers/twelvedata";
const SYMS = [{ symbol: "SPX", assetClass: "index" as const, display: "S&P 500", currency: "USD" }];
describe("twelvedataProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("supports index and commodity", () => {
    expect(twelvedataProvider.supports("index")).toBe(true);
    expect(twelvedataProvider.supports("crypto")).toBe(false);
  });
  it("maps /quote response", async () => {
    process.env.TWELVEDATA_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      close: "5303.27", change: "28.62", percent_change: "0.54",
    }))));
    const out = await twelvedataProvider.fetchQuotes(SYMS);
    const q = out.get("SPX")!;
    expect(q.price).toBeCloseTo(5303.27);
    expect(q.changePct).toBeCloseTo(0.54);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/lib/market/providers`
Expected: FAIL — frankfurter/finnhub/twelvedata modules not found.

- [ ] **Step 3: Implement the three providers**

`src/lib/market/providers/frankfurter.ts`:
```ts
import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

export const frankfurterProvider: QuoteProvider = {
  id: "frankfurter",
  supports: (c) => c === "fx",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const now = Date.now();
    for (const s of symbols) {
      const base = s.symbol.slice(0, 3);
      const quote = s.symbol.slice(3, 6);
      const res = await fetch(
        `https://api.frankfurter.app/latest?from=${base}&to=${quote}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as { rates: Record<string, number> };
      const price = data.rates?.[quote];
      if (price == null) continue;
      out.set(s.symbol, { price, changeAbs: 0, changePct: 0, asOf: now });
    }
    return out;
  },
};
```

`src/lib/market/providers/finnhub.ts`:
```ts
import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

export const finnhubProvider: QuoteProvider = {
  id: "finnhub",
  supports: (c) => c === "equity" || c === "fx",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.FINNHUB_API_KEY;
    if (!key) return out;
    const now = Date.now();
    for (const s of symbols) {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${s.symbol}&token=${key}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const d = (await res.json()) as { c: number; d: number; dp: number };
      if (!d.c) continue;
      out.set(s.symbol, {
        price: d.c, changeAbs: d.d ?? 0, changePct: d.dp ?? 0, asOf: now,
      });
    }
    return out;
  },
};
```

`src/lib/market/providers/twelvedata.ts`:
```ts
import type { QuoteProvider, RawQuote, SymbolDef } from "../types";

const TD_SYMBOL: Record<string, string> = {
  SPX: "SPX", NDX: "NDX", DJI: "DJI", VIX: "VIX",
  XAU: "XAU/USD", XAG: "XAG/USD",
};

export const twelvedataProvider: QuoteProvider = {
  id: "twelvedata",
  supports: (c) => c === "index" || c === "commodity",
  async fetchQuotes(symbols: SymbolDef[]) {
    const out = new Map<string, RawQuote>();
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) return out;
    const now = Date.now();
    for (const s of symbols) {
      const td = TD_SYMBOL[s.symbol] ?? s.symbol;
      const res = await fetch(
        `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(td)}&apikey=${key}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const d = (await res.json()) as
        { close?: string; change?: string; percent_change?: string };
      if (d.close == null) continue;
      out.set(s.symbol, {
        price: Number(d.close),
        changeAbs: Number(d.change ?? 0),
        changePct: Number(d.percent_change ?? 0),
        asOf: now,
      });
    }
    return out;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/lib/market/providers`
Expected: PASS (frankfurter 2, finnhub 3, twelvedata 2, plus coingecko/simulated still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/providers/frankfurter.ts src/lib/market/providers/finnhub.ts src/lib/market/providers/twelvedata.ts test/lib/market/providers
git commit -m "feat: frankfurter (keyless fx) + finnhub + twelvedata providers"
```

## Task B5: Router with ordered failover

**Files:**
- Create: `src/lib/market/router.ts`
- Test: `test/lib/market/router.test.ts`

- [ ] **Step 1: Write the failing test**

`test/lib/market/router.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { resolveQuotes } from "@/lib/market/router";
import type { QuoteProvider } from "@/lib/market/types";

const sym = { symbol: "BTC", assetClass: "crypto" as const, display: "Bitcoin", currency: "USD" };

function provider(id: any, ok: boolean): QuoteProvider {
  return {
    id,
    supports: () => true,
    fetchQuotes: vi.fn(async () =>
      ok ? new Map([["BTC", { price: 1, changeAbs: 0, changePct: 0, asOf: Date.now() }]])
         : new Map()),
  };
}

describe("resolveQuotes", () => {
  it("uses the primary provider when it succeeds", async () => {
    const primary = provider("coingecko", true);
    const fallback = provider("finnhub", true);
    const q = await resolveQuotes([sym], [primary, fallback]);
    expect(q[0].source).toBe("coingecko");
    expect(fallback.fetchQuotes).not.toHaveBeenCalled();
  });

  it("fails over to the next provider", async () => {
    const q = await resolveQuotes([sym], [provider("coingecko", false), provider("finnhub", true)]);
    expect(q[0].source).toBe("finnhub");
  });

  it("falls back to simulated when all fail and labels it", async () => {
    const q = await resolveQuotes([sym], [provider("coingecko", false)]);
    expect(q[0].source).toBe("simulated");
    expect(q[0].freshness).toBe("simulated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/market/router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

`src/lib/market/router.ts`:
```ts
import type { AssetClass, Quote, QuoteProvider, SymbolDef } from "./types";
import { computeFreshness } from "./freshness";
import { coingeckoProvider } from "./providers/coingecko";
import { frankfurterProvider } from "./providers/frankfurter";
import { finnhubProvider } from "./providers/finnhub";
import { twelvedataProvider } from "./providers/twelvedata";
import { simulatedProvider } from "./providers/simulated";

export const CHAINS: Record<AssetClass, QuoteProvider[]> = {
  crypto: [coingeckoProvider, finnhubProvider, simulatedProvider],
  fx: [frankfurterProvider, finnhubProvider, simulatedProvider],
  equity: [finnhubProvider, twelvedataProvider, simulatedProvider],
  index: [twelvedataProvider, finnhubProvider, simulatedProvider],
  commodity: [twelvedataProvider, simulatedProvider],
  bond: [twelvedataProvider, simulatedProvider],
};

export async function resolveQuotes(
  symbols: SymbolDef[],
  chainOverride?: QuoteProvider[]
): Promise<Quote[]> {
  const result: Quote[] = [];
  const byClass = new Map<AssetClass, SymbolDef[]>();
  for (const s of symbols) {
    byClass.set(s.assetClass, [...(byClass.get(s.assetClass) ?? []), s]);
  }
  for (const [assetClass, syms] of byClass) {
    const chain = chainOverride ?? CHAINS[assetClass];
    const pending = new Map(syms.map((s) => [s.symbol, s]));
    for (const provider of chain) {
      if (pending.size === 0) break;
      if (!provider.supports(assetClass)) continue;
      let raws: Awaited<ReturnType<QuoteProvider["fetchQuotes"]>>;
      try {
        raws = await provider.fetchQuotes([...pending.values()]);
      } catch {
        continue;
      }
      for (const [symbol, raw] of raws) {
        const def = pending.get(symbol);
        if (!def) continue;
        result.push({
          symbol: def.symbol,
          assetClass: def.assetClass,
          display: def.display,
          currency: def.currency,
          price: raw.price,
          changeAbs: raw.changeAbs,
          changePct: raw.changePct,
          asOf: raw.asOf,
          source: provider.id,
          freshness: computeFreshness(provider.id, raw.asOf),
        });
        pending.delete(symbol);
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/market/router.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/router.ts test/lib/market/router.test.ts
git commit -m "feat: per-class provider router with ordered failover"
```

## Task B6: Cache + single poller + `/api/quotes`

**Files:**
- Create: `src/lib/market/cache.ts`, `src/app/api/quotes/route.ts`
- Test: `test/lib/market/cache.test.ts`

- [ ] **Step 1: Write the failing test**

`test/lib/market/cache.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { QuoteCache } from "@/lib/market/cache";
import type { Quote } from "@/lib/market/types";

const q: Quote = {
  symbol: "BTC", assetClass: "crypto", display: "Bitcoin", currency: "USD",
  price: 1, changeAbs: 0, changePct: 0, asOf: Date.now(),
  source: "coingecko", freshness: "live",
};

describe("QuoteCache", () => {
  it("returns empty before first refresh", () => {
    const c = new QuoteCache(async () => [q]);
    expect(c.snapshot()).toEqual([]);
  });
  it("populates snapshot after refresh and dedupes by symbol", async () => {
    const fetcher = vi.fn(async () => [q, { ...q, price: 2 }]);
    const c = new QuoteCache(fetcher);
    await c.refresh();
    const snap = c.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].price).toBe(2);
  });
  it("keeps last good snapshot if a refresh throws", async () => {
    let calls = 0;
    const c = new QuoteCache(async () => {
      calls++;
      if (calls === 2) throw new Error("upstream down");
      return [q];
    });
    await c.refresh();
    await c.refresh(); // throws internally, swallowed
    expect(c.snapshot()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/lib/market/cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement cache + poller + route**

`src/lib/market/cache.ts`:
```ts
import type { Quote } from "./types";
import { ALL_SYMBOLS } from "./registry";
import { resolveQuotes } from "./router";

export class QuoteCache {
  private data = new Map<string, Quote>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private fetcher: () => Promise<Quote[]> =
    () => resolveQuotes(ALL_SYMBOLS)) {}

  snapshot(): Quote[] {
    return [...this.data.values()];
  }

  async refresh(): Promise<void> {
    try {
      const quotes = await this.fetcher();
      for (const q of quotes) this.data.set(q.symbol, q);
    } catch {
      // keep last good snapshot — never wipe on failure
    }
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __quoteCache: QuoteCache | undefined;
}

export function getQuoteCache(): QuoteCache {
  if (!globalThis.__quoteCache) {
    globalThis.__quoteCache = new QuoteCache();
    globalThis.__quoteCache.start();
  }
  return globalThis.__quoteCache;
}
```

`src/app/api/quotes/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getQuoteCache } from "@/lib/market/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const cache = getQuoteCache();
  if (cache.snapshot().length === 0) await cache.refresh();
  return NextResponse.json({ quotes: cache.snapshot() });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/lib/market/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/cache.ts src/app/api/quotes/route.ts test/lib/market/cache.test.ts
git commit -m "feat: in-memory quote cache, single poller, /api/quotes endpoint"
```

## Task B7: Quote store + polling hook (selector subscriptions)

**Files:**
- Create: `src/store/quotes.ts`, `src/hooks/useQuotesPoll.ts`
- Test: `test/store/quotes.test.ts`

- [ ] **Step 1: Write the failing test**

`test/store/quotes.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useQuotes } from "@/store/quotes";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "equity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "finnhub", freshness: "live",
});

describe("quotes store", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: {} }));

  it("ingests quotes keyed by symbol", () => {
    useQuotes.getState().ingest([mk("AAPL", 100), mk("MSFT", 200)]);
    expect(useQuotes.getState().bySymbol.AAPL.price).toBe(100);
  });

  it("selectQuote returns a stable reference when unrelated symbol changes", () => {
    useQuotes.getState().ingest([mk("AAPL", 100), mk("MSFT", 200)]);
    const a1 = useQuotes.getState().bySymbol.AAPL;
    useQuotes.getState().ingest([mk("MSFT", 201)]);
    const a2 = useQuotes.getState().bySymbol.AAPL;
    expect(a2).toBe(a1); // AAPL object identity preserved -> no re-render
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/store/quotes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement store + hook**

`src/store/quotes.ts`:
```ts
import { create } from "zustand";
import type { Quote } from "@/lib/market/types";

interface QuotesState {
  bySymbol: Record<string, Quote>;
  ingest: (quotes: Quote[]) => void;
}

export const useQuotes = create<QuotesState>()((set) => ({
  bySymbol: {},
  ingest: (quotes) =>
    set((state) => {
      const next = { ...state.bySymbol };
      for (const q of quotes) {
        const prev = next[q.symbol];
        // preserve object identity if nothing changed -> selector subs skip render
        if (
          prev &&
          prev.price === q.price &&
          prev.changePct === q.changePct &&
          prev.freshness === q.freshness
        ) {
          continue;
        }
        next[q.symbol] = q;
      }
      return { bySymbol: next };
    }),
}));

export const selectQuote = (symbol: string) => (s: QuotesState) => s.bySymbol[symbol];
```

`src/hooks/useQuotesPoll.ts`:
```ts
"use client";
import { useEffect } from "react";
import { useQuotes } from "@/store/quotes";
import { useSetting } from "@/hooks/useSetting";

export function useQuotesPoll() {
  const refreshSeconds = useSetting("refreshSeconds");
  const ingest = useQuotes((s) => s.ingest);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) return;
        const { quotes } = await res.json();
        if (!cancelled) ingest(quotes);
      } catch {
        // transient; next tick retries
      }
    }
    void tick();
    const id = setInterval(tick, refreshSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshSeconds, ingest]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/store/quotes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/quotes.ts src/hooks/useQuotesPoll.ts test/store/quotes.test.ts
git commit -m "feat: quote store with identity-preserving ingest + polling hook"
```

## Task B8: Market UI — TickerStrip, MiniCards, TopStocksTable, MarketAnalysisPanel

**Files:**
- Create: `src/components/market/Sparkline.tsx`, `TickerStrip.tsx`, `MiniCards.tsx`, `TopStocksTable.tsx`, `MarketAnalysisPanel.tsx`
- Test: `test/components/market/TopStocksTable.test.tsx`

- [ ] **Step 1: Write the failing test**

`test/components/market/TopStocksTable.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { TopStocksTable } from "@/components/market/TopStocksTable";
import type { Quote } from "@/lib/market/types";

const q: Quote = {
  symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD",
  price: 195.84, changeAbs: 2.17, changePct: 1.12, asOf: Date.now(),
  source: "finnhub", freshness: "live",
};

describe("TopStocksTable", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { AAPL: q } }));
  it("renders a row with price and a freshness dot", () => {
    render(<TopStocksTable />);
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
    expect(screen.getByText("195.84")).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot")[0]).toHaveAttribute(
      "data-freshness", "live");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/components/market/TopStocksTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement market components**

`src/components/market/Sparkline.tsx`:
```tsx
"use client";
import { useEffect, useRef } from "react";
import { createChart, type IChartApi } from "lightweight-charts";

export function Sparkline({ points }: { points: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart: IChartApi = createChart(ref.current, {
      width: 96, height: 28,
      layout: { background: { color: "transparent" }, textColor: "transparent" },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      grid: { horzLines: { visible: false }, vertLines: { visible: false } },
      handleScroll: false, handleScale: false,
    });
    const series = chart.addLineSeries({ lineWidth: 1 });
    series.setData(points.map((v, i) => ({ time: (i + 1) as any, value: v })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={ref} data-testid="sparkline" />;
}
```

`src/components/market/TopStocksTable.tsx`:
```tsx
"use client";
import { useQuotes } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const ROWS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META"];

export function TopStocksTable() {
  const bySymbol = useQuotes((s) => s.bySymbol);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-text/50 text-left">
          <th>Symbol</th><th>Company</th><th>Price</th><th>Chg %</th><th></th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((sym) => {
          const q = bySymbol[sym];
          if (!q) return (
            <tr key={sym}><td>{sym}</td><td colSpan={4} className="text-text/30">—</td></tr>
          );
          return (
            <tr key={sym}>
              <td className="font-mono">{q.symbol}</td>
              <td>{q.display}</td>
              <td className="font-mono">{q.price.toFixed(2)}</td>
              <td className={q.changePct >= 0 ? "text-ok" : "text-bad"}>
                {q.changePct.toFixed(2)}%
              </td>
              <td><FreshnessDot freshness={q.freshness} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

`src/components/market/MiniCards.tsx`:
```tsx
"use client";
import { useQuotes } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const CARDS = ["XAU", "XAG", "BTC", "ETH", "SOL"];

export function MiniCards() {
  const bySymbol = useQuotes((s) => s.bySymbol);
  return (
    <div className="grid grid-cols-5 gap-2">
      {CARDS.map((sym) => {
        const q = bySymbol[sym];
        return (
          <div key={sym} className="rounded bg-bg p-2">
            <div className="flex items-center justify-between text-xs text-text/60">
              {q?.display ?? sym}
              {q && <FreshnessDot freshness={q.freshness} />}
            </div>
            <div className="font-mono text-lg">{q ? q.price.toFixed(2) : "—"}</div>
            <div className={`text-xs ${(q?.changePct ?? 0) >= 0 ? "text-ok" : "text-bad"}`}>
              {q ? `${q.changePct.toFixed(2)}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

`src/components/market/TickerStrip.tsx`:
```tsx
"use client";
import { useQuotes } from "@/store/quotes";

const TICKER = ["SPX", "NDX", "DJI", "VIX", "BTC", "ETH"];

export function TickerStrip() {
  const bySymbol = useQuotes((s) => s.bySymbol);
  return (
    <div className="flex gap-4 font-mono text-xs">
      {TICKER.map((sym) => {
        const q = bySymbol[sym];
        return (
          <span key={sym} className="whitespace-nowrap">
            <span className="text-text/60">{q?.display ?? sym}</span>{" "}
            <span>{q ? q.price.toFixed(2) : "—"}</span>{" "}
            <span className={(q?.changePct ?? 0) >= 0 ? "text-ok" : "text-bad"}>
              {q ? `${q.changePct.toFixed(2)}%` : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}
```

`src/components/market/MarketAnalysisPanel.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { MiniCards } from "./MiniCards";
import { TopStocksTable } from "./TopStocksTable";

const TABS = ["Overview", "Indices", "Commodities", "Crypto", "Forex", "Bonds"] as const;

export function MarketAnalysisPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  return (
    <Panel title="Market Analysis" state="ready">
      <div className="mb-2 flex gap-2 text-xs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={t === tab ? "text-gold" : "text-text/50"}>{t}</button>
        ))}
      </div>
      <MiniCards />
      <div className="mt-3"><TopStocksTable /></div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/components/market/TopStocksTable.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/market test/components/market
git commit -m "feat: market UI (ticker, mini-cards, stocks table, analysis panel)"
```

## Task B9: Wire market panels into the dashboard + start polling

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/dashboard/QuotesProvider.tsx`
- Test: `test/components/QuotesProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

`test/components/QuotesProvider.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { useQuotes } from "@/store/quotes";

describe("QuotesProvider", () => {
  afterEach(() => vi.restoreAllMocks());
  it("polls /api/quotes and ingests into the store", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      quotes: [{
        symbol: "AAPL", assetClass: "equity", display: "Apple Inc.", currency: "USD",
        price: 195.84, changeAbs: 2, changePct: 1.1, asOf: Date.now(),
        source: "finnhub", freshness: "live",
      }],
    }))));
    render(<QuotesProvider><div>child</div></QuotesProvider>);
    expect(screen.getByText("child")).toBeInTheDocument();
    await waitFor(() =>
      expect(useQuotes.getState().bySymbol.AAPL?.price).toBe(195.84));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/components/QuotesProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement provider + wire page**

`src/components/dashboard/QuotesProvider.tsx`:
```tsx
"use client";
import type { ReactNode } from "react";
import { useQuotesPoll } from "@/hooks/useQuotesPoll";

export function QuotesProvider({ children }: { children: ReactNode }) {
  useQuotesPoll();
  return <>{children}</>;
}
```

`src/app/page.tsx`:
```tsx
import { Shell } from "@/components/dashboard/Shell";
import { Panel } from "@/components/Panel";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { MarketAnalysisPanel } from "@/components/market/MarketAnalysisPanel";

export default function Home() {
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <div className="grid grid-cols-4 gap-3" data-testid="dashboard-root">
          <div className="col-span-2"><MarketAnalysisPanel /></div>
          <Panel title="Company Overview" state="unwired" />
          <Panel title="Revenue Projections" state="unwired" />
          <Panel title="Work Orders" state="unwired" />
          <Panel title="Client Satisfaction" state="unwired" />
        </div>
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 4: Run test + full suite + build**

Run: `npm run test && npm run build`
Expected: entire suite PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire live market panels + ticker into dashboard"
```

## Task B10: Render-isolation performance test

**Files:**
- Test: `test/perf/render-isolation.test.tsx`

- [ ] **Step 1: Write the test**

`test/perf/render-isolation.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useQuotes, selectQuote } from "@/store/quotes";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "equity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "finnhub", freshness: "live",
});

function Cell({ symbol, onRender }: { symbol: string; onRender: () => void }) {
  const q = useQuotes(selectQuote(symbol));
  onRender();
  return <span>{q?.price}</span>;
}

describe("render isolation", () => {
  beforeEach(() =>
    useQuotes.setState({ bySymbol: { AAPL: mk("AAPL", 1), MSFT: mk("MSFT", 1) } }));

  it("a tick on one symbol does not re-render an unrelated cell", () => {
    let aapl = 0;
    let msft = 0;
    render(<><Cell symbol="AAPL" onRender={() => aapl++} />
            <Cell symbol="MSFT" onRender={() => msft++} /></>);
    const baseMsft = msft;
    useQuotes.getState().ingest([mk("AAPL", 999)]);
    expect(aapl).toBeGreaterThan(1);   // AAPL cell re-rendered
    expect(msft).toBe(baseMsft);       // MSFT cell did NOT
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test -- test/perf/render-isolation.test.tsx`
Expected: PASS (1 test) — confirms selector subscriptions isolate renders (spec §8.1 acceptance criterion).

- [ ] **Step 3: Commit**

```bash
git add test/perf/render-isolation.test.tsx
git commit -m "test: assert single-symbol tick does not re-render unrelated panels"
```

## Task B11: Phase B manual verification + slice tag

- [ ] **Step 1: Configure keys and run live**

Copy `.env.example` to `.env`, set `SESSION_SECRET`, `DASHBOARD_USER`,
`DASHBOARD_PASSWORD`, and (optionally) `FINNHUB_API_KEY` / `TWELVEDATA_API_KEY`.

Run: `npm run dev`, log in, then verify at `http://localhost:3000`:
- Header ticker shows S&P/NASDAQ/DOW/VIX/BTC/ETH with values + green/amber dots.
- Market Analysis panel: mini-cards (gold/silver/BTC/ETH/SOL) and the Top-7 stocks
  table populate within ~15s.
- With no keys set: crypto (CoinGecko) and fx still show **live**; equities/indices/
  commodities show **simulated** (outline dot) — never blank, never silently fake.
- Other panels still show "Not yet wired".
- Lower "Refresh (s)" in Settings → values update faster; raise it → slower.

- [ ] **Step 2: Tag the slice**

```bash
git add -A && git commit -m "chore: phase B verification fixes" --allow-empty
git tag slice-1-market-data
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 stack → A1/A2; §6 design system/Panel → A2/A5; §6 settings →
  A3/A6; §6 auth → A4; §5.1 Quote → B1; §5.2 routing/registry → B1/B5; §5.3 single
  poller/cache → B6; client-vs-upstream cadence → B7; §5.4 freshness → B1/B5; §5.5
  degradation → B2/B5; §7 market panels → B8/B9; §8.1 render isolation → B7/B10;
  §9 testing tiers → unit (B1–B7), integration (B5/B6/B9), component (A5/A6/B8),
  perf (B10). No uncovered spec section.
- **Placeholder scan:** no TBD/TODO; every code step contains full code; every test
  step contains real assertions.
- **Type consistency:** `Quote`, `RawQuote`, `QuoteProvider`, `SymbolDef`,
  `AssetClass`, `ProviderId`, `Freshness` defined once in B1 and used unchanged
  through B5–B10; `useSettings.set`, `useQuotes.ingest`, `selectQuote`,
  `resolveQuotes`, `getQuoteCache`, `computeFreshness` signatures consistent across
  all consuming tasks.

## Out of Scope (later slices, per spec §11)

Real backends for company/HR/ops/financial/social/notifications/AI/terminal; paid
data tiers; full commodity/bond coverage; passkey/MFA hardening; multi-user auth.
