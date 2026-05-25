# AIYA Designs Dashboard — Slice 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recast the dashboard as the AIYA Designs jewelry command center matching mockup 1 — every metals/crypto/FX panel genuinely live, a broad-currency converter, real Gold/BTC price-history chart, and honest placeholders for all business panels.

**Architecture:** Pure presentation + market-layer slice. Extend the static symbol registry (Platinum, USD/AED) and two providers; add two keyless-friendly server routes (`/api/convert` for broad FX, `/api/history` for the trend chart) that proxy through our layer. New client panels subscribe to the existing `useQuotes` selector store and render the existing `FreshnessDot`. No new database tables (business data is slice 1b).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind, Zustand (selector subscriptions), Recharts (multi-line trend), lightweight-charts (canvas sparklines), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-24-aiya-designs-dashboard-slice-1a-design.md`

**Conventions:**
- Run a single test file with: `npx vitest run <path>`
- Money/price values are numbers from the `Quote` type; no new persistence.
- Every live cell reads `quote.freshness` and renders `<FreshnessDot>` — never a bare number without provenance.
- Commit after every green step.

---

## Phase A — Market data layer additions

### Task A1: Register Platinum (XPT) and USD/AED

**Files:**
- Modify: `src/lib/market/registry.ts`
- Test: `test/lib/market/registry.test.ts`

- [ ] **Step 1: Add failing assertions**

Append inside the existing `describe("registry", …)` block in `test/lib/market/registry.test.ts`:

```ts
  it("registers platinum as a commodity", () => {
    expect(lookup("XPT")?.assetClass).toBe("commodity");
    expect(lookup("XPT")?.display).toBe("Platinum");
  });
  it("registers USD/AED as fx", () => {
    expect(lookup("USDAED")?.assetClass).toBe("fx");
    expect(lookup("USDAED")?.currency).toBe("AED");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/market/registry.test.ts`
Expected: FAIL — `lookup("XPT")` is `undefined`.

- [ ] **Step 3: Add the symbols**

In `src/lib/market/registry.ts`, add these two entries to the `ALL_SYMBOLS` array (after the `XAG` line):

```ts
  { symbol: "XPT", assetClass: "commodity", display: "Platinum", currency: "USD" },
  { symbol: "USDAED", assetClass: "fx", display: "USD/AED", currency: "AED" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/market/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/registry.ts test/lib/market/registry.test.ts
git commit -m "feat(market): register Platinum (XPT) and USD/AED symbols"
```

---

### Task A2: Map Platinum in the Twelve Data provider

**Files:**
- Modify: `src/lib/market/providers/twelvedata.ts:3-6`
- Test: `test/lib/market/providers/twelvedata.test.ts`

- [ ] **Step 1: Add failing test**

Open `test/lib/market/providers/twelvedata.test.ts`. Add a test that asserts XPT requests the `XPT/USD` Twelve Data symbol. Match the existing mock style in that file (it stubs `global.fetch` and sets `process.env.TWELVEDATA_API_KEY`). Add inside the top-level `describe`:

```ts
  it("requests XPT/USD for platinum", async () => {
    process.env.TWELVEDATA_API_KEY = "k";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ close: "1021.30", change: "4.30", percent_change: "0.44" }),
      } as Response;
    });
    const out = await twelvedataProvider.fetchQuotes([
      { symbol: "XPT", assetClass: "commodity", display: "Platinum", currency: "USD" },
    ]);
    expect(calls[0]).toContain("XPT%2FUSD");
    expect(out.get("XPT")?.price).toBe(1021.3);
  });
```

If `vi` / `twelvedataProvider` aren't imported yet in this file, add to the imports at the top:

```ts
import { vi } from "vitest";
import { twelvedataProvider } from "@/lib/market/providers/twelvedata";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/market/providers/twelvedata.test.ts`
Expected: FAIL — request uses `XPT` (URL-encoded `XPT`) not `XPT%2FUSD`.

- [ ] **Step 3: Add the mapping**

In `src/lib/market/providers/twelvedata.ts`, extend the `TD_SYMBOL` map:

```ts
const TD_SYMBOL: Record<string, string> = {
  SPX: "SPX", NDX: "NDX", DJI: "DJI", VIX: "VIX",
  XAU: "XAU/USD", XAG: "XAG/USD", XPT: "XPT/USD",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/market/providers/twelvedata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/providers/twelvedata.ts test/lib/market/providers/twelvedata.test.ts
git commit -m "feat(market): map Platinum to XPT/USD in Twelve Data provider"
```

---

### Task A3: Add simulated reference levels for XPT and USD/AED

**Files:**
- Modify: `src/lib/market/providers/simulated.ts:5-12`
- Test: `test/lib/market/providers/simulated.test.ts`

- [ ] **Step 1: Add failing test**

Add to `test/lib/market/providers/simulated.test.ts` inside its `describe`:

```ts
  it("uses plausible reference levels for platinum and the AED peg", async () => {
    const out = await simulatedProvider.fetchQuotes([
      { symbol: "XPT", assetClass: "commodity", display: "Platinum", currency: "USD" },
      { symbol: "USDAED", assetClass: "fx", display: "USD/AED", currency: "AED" },
    ]);
    // Platinum near ~$1000/oz, not the 10..110 seeded fallback.
    expect(out.get("XPT")!.price).toBeGreaterThan(800);
    // AED is a hard USD peg around 3.6725.
    expect(out.get("USDAED")!.price).toBeCloseTo(3.6725, 1);
  });
```

Ensure the file imports `simulatedProvider` (it should already). If not:

```ts
import { simulatedProvider } from "@/lib/market/providers/simulated";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/market/providers/simulated.test.ts`
Expected: FAIL — XPT and USDAED hit the seeded `10..110` fallback.

- [ ] **Step 3: Add reference levels**

In `src/lib/market/providers/simulated.ts`, add to the `REFERENCE` map:

```ts
  XAU: 2389.25, XAG: 28.56, XPT: 1021.30,
  USDAED: 3.6725,
```

(Replace the existing `XAU: 2389.25, XAG: 28.56,` line with the line above so XPT/USDAED sit alongside the other commodities/fx.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/market/providers/simulated.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/providers/simulated.ts test/lib/market/providers/simulated.test.ts
git commit -m "feat(market): add simulated reference levels for XPT and USD/AED"
```

---

### Task A4: Currency-conversion helper (broad FX via Frankfurter)

**Files:**
- Create: `src/lib/market/convert.ts`
- Test: `test/lib/market/convert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/lib/market/convert.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCurrencyList, convertCurrency } from "@/lib/market/convert";

afterEach(() => vi.unstubAllGlobals());

describe("currency convert helper", () => {
  it("returns the broad Frankfurter currency list (30+ currencies)", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        USD: "United States Dollar", EUR: "Euro", GBP: "British Pound",
        INR: "Indian Rupee", JPY: "Japanese Yen", CHF: "Swiss Franc",
        CNY: "Chinese Yuan", AUD: "Australian Dollar", CAD: "Canadian Dollar",
        SGD: "Singapore Dollar", HKD: "Hong Kong Dollar", SEK: "Swedish Krona",
        NOK: "Norwegian Krone", NZD: "New Zealand Dollar", ZAR: "South African Rand",
        BRL: "Brazilian Real", MXN: "Mexican Peso", PLN: "Polish Zloty",
        TRY: "Turkish Lira", THB: "Thai Baht", KRW: "South Korean Won",
        IDR: "Indonesian Rupiah", MYR: "Malaysian Ringgit", PHP: "Philippine Peso",
        CZK: "Czech Koruna", HUF: "Hungarian Forint", DKK: "Danish Krone",
        ILS: "Israeli Shekel", RON: "Romanian Leu", BGN: "Bulgarian Lev",
        ISK: "Icelandic Krona",
      }),
    } as Response));
    const list = await fetchCurrencyList();
    expect(Object.keys(list).length).toBeGreaterThanOrEqual(30);
    expect(list.INR).toBe("Indian Rupee");
  });

  it("converts an amount using the Frankfurter rate", async () => {
    // Frankfurter's ?amount= endpoint returns the already-scaled value in rates[to]:
    // amount 1000 USD -> 83200 INR (unit rate 83.2).
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ amount: 1000, base: "USD", date: "2026-05-23", rates: { INR: 83200 } }),
    } as Response));
    const r = await convertCurrency("USD", "INR", 1000);
    expect(r.result).toBeCloseTo(83200, 1);
    expect(r.rate).toBeCloseTo(83.2, 3); // unit rate = result / amount
    expect(r.freshness).toBe("delayed"); // ECB daily reference, never "live"
  });

  it("returns simulated freshness when Frankfurter is unavailable", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false } as Response));
    const r = await convertCurrency("USD", "AED", 100);
    expect(r.freshness).toBe("simulated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/market/convert.test.ts`
Expected: FAIL — module `@/lib/market/convert` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/market/convert.ts`:

```ts
import type { Freshness } from "./types";

const BASE = "https://api.frankfurter.app";

export interface ConversionResult {
  from: string;
  to: string;
  amount: number;
  rate: number;
  result: number;
  asOf: number;
  freshness: Freshness;
}

/** Frankfurter's full supported-currency map: code -> human name. */
export async function fetchCurrencyList(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/currencies`, { cache: "no-store" });
  if (!res.ok) return {};
  return (await res.json()) as Record<string, string>;
}

/** Convert via Frankfurter (ECB daily). Honest freshness: never "live". */
export async function convertCurrency(
  from: string,
  to: string,
  amount: number,
): Promise<ConversionResult> {
  const now = Date.now();
  if (from === to) {
    return { from, to, amount, rate: 1, result: amount, asOf: now, freshness: "delayed" };
  }
  try {
    const res = await fetch(
      `${BASE}/latest?amount=${amount}&from=${from}&to=${to}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("frankfurter unavailable");
    const data = (await res.json()) as { rates?: Record<string, number> };
    const result = data.rates?.[to];
    if (result == null) throw new Error("rate missing");
    return { from, to, amount, rate: result / amount, result, asOf: now, freshness: "delayed" };
  } catch {
    // Honest degradation: pegged/last-resort estimate, clearly labeled simulated.
    return { from, to, amount, rate: 1, result: amount, asOf: now, freshness: "simulated" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/market/convert.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/convert.ts test/lib/market/convert.test.ts
git commit -m "feat(market): add broad-currency Frankfurter conversion helper"
```

---

### Task A5: `/api/convert` route

**Files:**
- Create: `src/app/api/convert/route.ts`
- Test: `test/app/api/convert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/app/api/convert.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/convert/route";

afterEach(() => vi.unstubAllGlobals());

function req(url: string) {
  return new Request(`http://localhost${url}`);
}

describe("/api/convert", () => {
  it("returns the currency list when no from/to is given", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ USD: "United States Dollar", INR: "Indian Rupee" }),
    } as Response));
    const res = await GET(req("/api/convert"));
    const body = await res.json();
    expect(body.currencies.INR).toBe("Indian Rupee");
  });

  it("returns a conversion when from/to/amount are given", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ rates: { INR: 83200 } }),
    } as Response));
    const res = await GET(req("/api/convert?from=USD&to=INR&amount=1000"));
    const body = await res.json();
    expect(body.result).toBe(83200);
    expect(body.freshness).toBe("delayed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app/api/convert.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/convert/route.ts`:

```ts
import { NextResponse } from "next/server";
import { fetchCurrencyList, convertCurrency } from "@/lib/market/convert";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    const currencies = await fetchCurrencyList();
    return NextResponse.json({ currencies });
  }

  const amount = Number(searchParams.get("amount") ?? "1");
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;
  const conversion = await convertCurrency(from, to, safeAmount);
  return NextResponse.json(conversion);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/app/api/convert.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/convert/route.ts test/app/api/convert.test.ts
git commit -m "feat(api): add /api/convert route for broad-currency conversion"
```

---

### Task A6: Price-history helper (real Gold + BTC series)

**Files:**
- Create: `src/lib/market/history.ts`
- Test: `test/lib/market/history.test.ts`

CoinGecko market-chart (keyless) gives real BTC history; Twelve Data `time_series` gives real Gold history when a key is present, else an honest simulated series. Range buttons map to day counts.

- [ ] **Step 1: Write the failing test**

Create `test/lib/market/history.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { rangeToDays, fetchHistory } from "@/lib/market/history";

afterEach(() => vi.unstubAllGlobals());

describe("price history", () => {
  it("maps range labels to day counts", () => {
    expect(rangeToDays("1D")).toBe(1);
    expect(rangeToDays("1M")).toBe(30);
    expect(rangeToDays("1Y")).toBe(365);
    expect(rangeToDays("ALL")).toBe(1825);
  });

  it("returns a real BTC series from CoinGecko (keyless)", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ prices: [[1, 67000], [2, 67500], [3, 68000]] }),
    } as Response));
    const series = await fetchHistory("BTC", "1M");
    expect(series.points).toEqual([67000, 67500, 68000]);
    expect(series.freshness).toBe("live");
  });

  it("falls back to a labeled simulated series for gold without a key", async () => {
    delete process.env.TWELVEDATA_API_KEY;
    const series = await fetchHistory("XAU", "1M");
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.freshness).toBe("simulated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/market/history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/market/history.ts`:

```ts
import type { Freshness } from "./types";

export type Range = "1D" | "7D" | "1M" | "3M" | "1Y" | "ALL";

export interface HistorySeries {
  symbol: string;
  points: number[];
  freshness: Freshness;
}

export function rangeToDays(range: Range): number {
  switch (range) {
    case "1D": return 1;
    case "7D": return 7;
    case "1M": return 30;
    case "3M": return 90;
    case "1Y": return 365;
    case "ALL": return 1825;
  }
}

const CG_ID: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };

async function cryptoHistory(symbol: string, days: number): Promise<number[]> {
  const id = CG_ID[symbol];
  if (!id) return [];
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { prices?: [number, number][] };
  return (data.prices ?? []).map(([, v]) => v);
}

async function tdHistory(tdSymbol: string, days: number): Promise<number[]> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return [];
  const res = await fetch(
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}` +
      `&interval=1day&outputsize=${days}&apikey=${key}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { values?: { close: string }[] };
  return (data.values ?? []).map((v) => Number(v.close)).reverse();
}

function simulatedSeries(base: number, days: number): number[] {
  const n = Math.min(days, 180);
  return Array.from({ length: n }, (_, i) => +(base + Math.sin(i / 6) * base * 0.03).toFixed(2));
}

export async function fetchHistory(symbol: string, range: Range): Promise<HistorySeries> {
  const days = rangeToDays(range);
  if (CG_ID[symbol]) {
    const points = await cryptoHistory(symbol, days);
    if (points.length) return { symbol, points, freshness: "live" };
  }
  if (symbol === "XAU" || symbol === "XAG" || symbol === "XPT") {
    const points = await tdHistory(`${symbol}/USD`, days);
    if (points.length) return { symbol, points, freshness: "live" };
    const base = symbol === "XAU" ? 2389.25 : symbol === "XPT" ? 1021.3 : 28.56;
    return { symbol, points: simulatedSeries(base, days), freshness: "simulated" };
  }
  return { symbol, points: simulatedSeries(100, days), freshness: "simulated" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/market/history.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/market/history.ts test/lib/market/history.test.ts
git commit -m "feat(market): add real Gold/BTC price-history helper with honest fallback"
```

---

### Task A7: `/api/history` route

**Files:**
- Create: `src/app/api/history/route.ts`
- Test: `test/app/api/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/app/api/history.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { GET } from "@/app/api/history/route";

afterEach(() => vi.unstubAllGlobals());

describe("/api/history", () => {
  it("returns a series for the requested symbol and range", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ prices: [[1, 100], [2, 101]] }),
    } as Response));
    const res = await GET(new Request("http://localhost/api/history?symbol=BTC&range=1M"));
    const body = await res.json();
    expect(body.symbol).toBe("BTC");
    expect(body.points).toEqual([100, 101]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app/api/history.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/history/route.ts`:

```ts
import { NextResponse } from "next/server";
import { fetchHistory, type Range } from "@/lib/market/history";

export const dynamic = "force-dynamic";

const RANGES: Range[] = ["1D", "7D", "1M", "3M", "1Y", "ALL"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "BTC";
  const rangeParam = searchParams.get("range") as Range | null;
  const range: Range = rangeParam && RANGES.includes(rangeParam) ? rangeParam : "1M";
  const series = await fetchHistory(symbol, range);
  return NextResponse.json(series);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/app/api/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/history/route.ts test/app/api/history.test.ts
git commit -m "feat(api): add /api/history route for the price-trend chart"
```

---

## Phase B — Branding & shell reskin

### Task B1: AIYA palette + category accent tokens

**Files:**
- Modify: `src/app/globals.css`
- Test: `test/tailwind.test.ts`

- [ ] **Step 1: Add failing test**

Append to `test/tailwind.test.ts` (it reads `src/app/globals.css` as text — match that existing pattern). Add inside its `describe`:

```ts
  it("defines category accent tokens used by AIYA charts", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--accent-purple");
    expect(css).toContain("--accent-blue");
    expect(css).toContain("--accent-pink");
  });
```

If `readFileSync` isn't imported in that file, add at top:

```ts
import { readFileSync } from "node:fs";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tailwind.test.ts`
Expected: FAIL — tokens absent.

- [ ] **Step 3: Add tokens**

In `src/app/globals.css`, extend the `:root` block:

```css
:root {
  --bg: 220 26% 6%;
  --surface: 222 24% 9%;
  --gold: 43 74% 60%;
  --teal: 168 64% 52%;
  --text: 210 20% 90%;
  --gold-intensity: 0.8;
  --accent-purple: 268 60% 62%;
  --accent-blue: 205 80% 58%;
  --accent-pink: 330 70% 64%;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tailwind.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire tokens into Tailwind**

In `tailwind.config.ts`, add to the `colors` object (after `bad`):

```ts
        "accent-purple": "hsl(var(--accent-purple))",
        "accent-blue": "hsl(var(--accent-blue))",
        "accent-pink": "hsl(var(--accent-pink))",
```

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css tailwind.config.ts test/tailwind.test.ts
git commit -m "feat(ui): add AIYA category accent color tokens"
```

---

### Task B2: AIYA top bar (wordmark, greeting, tagline)

**Files:**
- Modify: `src/components/dashboard/TopBar.tsx`
- Test: `test/components/dashboard/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/dashboard/TopBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/dashboard/TopBar";

describe("TopBar", () => {
  it("shows AIYA branding and greeting, not the old wordmark", () => {
    render(<TopBar />);
    expect(screen.getByText(/AIYA/i)).toBeInTheDocument();
    expect(screen.getByText(/Good Morning/i)).toBeInTheDocument();
    expect(screen.queryByText(/CHILLY\.AI/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/dashboard/TopBar.test.tsx`
Expected: FAIL — still renders `CHILLY.AI`.

- [ ] **Step 3: Implement**

Replace the contents of `src/components/dashboard/TopBar.tsx`:

```tsx
import type { ReactNode } from "react";

export function TopBar({ ticker }: { ticker?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 bg-surface px-4 py-2">
      <div className="flex flex-col leading-tight">
        <span className="font-display text-gold text-lg tracking-[0.3em]">AIYA DESIGNS</span>
        <span className="text-text/40 text-[10px] tracking-wider">
          Crafting Brilliance. Building Trust.
        </span>
      </div>
      <div className="ml-2">
        <div className="text-sm text-text">Good Morning, AIYA</div>
        <div className="text-xs text-text/50">Here&apos;s what&apos;s happening with your business today.</div>
      </div>
      <div className="ml-auto flex items-center gap-4">{ticker}</div>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/dashboard/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Fix the now-stale Shell test (regression)**

`test/components/Shell.test.tsx` asserts the old `"CHILLY.AI"` wordmark, which no longer
exists. Replace its assertion line:

```tsx
    expect(screen.getByText("CHILLY.AI")).toBeInTheDocument();
```

with:

```tsx
    expect(screen.getByText("AIYA DESIGNS")).toBeInTheDocument();
```

Run: `npx vitest run test/components/Shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/TopBar.tsx test/components/dashboard/TopBar.test.tsx test/components/Shell.test.tsx
git commit -m "feat(ui): rebrand top bar to AIYA Designs with greeting"
```

---

### Task B3: AIYA navigation sections

**Files:**
- Modify: `src/components/dashboard/Nav.tsx`
- Test: `test/components/dashboard/Nav.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/dashboard/Nav.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "@/components/dashboard/Nav";

describe("Nav", () => {
  it("lists the AIYA business sections", () => {
    render(<Nav />);
    for (const label of ["Dashboard", "TradeNet Exchange", "Inventory", "Diamonds",
      "Gold & Metals", "Crypto Wallet", "Converter Hub", "Settings"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
  it("marks Dashboard as the active section", () => {
    render(<Nav />);
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/dashboard/Nav.test.tsx`
Expected: FAIL — old section labels.

- [ ] **Step 3: Implement**

Replace `src/components/dashboard/Nav.tsx`:

```tsx
const SECTIONS = [
  "Dashboard", "Command Center", "TradeNet Exchange", "Market Intelligence",
  "Inventory", "Diamonds", "Gold & Metals", "Orders & Deals", "Clients & CRM",
  "Finances", "Payments", "POS System", "Crypto Wallet", "Converter Hub",
  "Reports & Analytics", "Marketing Suite", "Social & Inbox", "Calendar & Tasks",
  "Documents", "Settings",
];

export function Nav() {
  return (
    <nav className="w-52 shrink-0 space-y-0.5 overflow-y-auto bg-surface p-3" aria-label="Primary">
      {SECTIONS.map((s) => {
        const active = s === "Dashboard";
        return (
          <div
            key={s}
            aria-current={active ? "page" : undefined}
            className={`cursor-default rounded px-2 py-1.5 text-sm ${
              active ? "bg-gold/10 text-gold" : "text-text/70 hover:text-gold"
            }`}
          >
            {s}
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/dashboard/Nav.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/Nav.tsx test/components/dashboard/Nav.test.tsx
git commit -m "feat(ui): replace nav with AIYA business sections"
```

---

### Task B4: AIYA footer status bar with live ticker

**Files:**
- Modify: `src/components/dashboard/FooterBar.tsx`
- Test: `test/components/dashboard/FooterBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/dashboard/FooterBar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { FooterBar } from "@/components/dashboard/FooterBar";
import type { Quote } from "@/lib/market/types";

const gold: Quote = {
  symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD",
  price: 2386.45, changeAbs: 20, changePct: 0.85, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
};

describe("FooterBar", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: gold } }));
  it("shows a live Gold value with a freshness dot", () => {
    render(<FooterBar />);
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/dashboard/FooterBar.test.tsx`
Expected: FAIL — footer has no quote binding.

- [ ] **Step 3: Implement**

Replace `src/components/dashboard/FooterBar.tsx`:

```tsx
"use client";
import { useQuotes } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const FOOTER = ["XAU", "BTC"];

export function FooterBar() {
  const bySymbol = useQuotes((s) => s.bySymbol);
  return (
    <footer className="flex items-center gap-6 bg-surface px-4 py-1 text-xs text-text/60">
      {FOOTER.map((sym) => {
        const q = bySymbol[sym];
        return (
          <span key={sym} className="flex items-center gap-1 font-mono">
            <span className="text-text/50">{q?.display ?? sym}</span>
            <span>{q ? q.price.toFixed(2) : "—"}</span>
            <span className={(q?.changePct ?? 0) >= 0 ? "text-ok" : "text-bad"}>
              {q ? `${q.changePct.toFixed(2)}%` : ""}
            </span>
            {q && <FreshnessDot freshness={q.freshness} />}
          </span>
        );
      })}
      <span className="ml-auto">Dubai, UAE · All Systems Operational</span>
    </footer>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/dashboard/FooterBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/FooterBar.tsx test/components/dashboard/FooterBar.test.tsx
git commit -m "feat(ui): AIYA footer status bar with live Gold/BTC ticker"
```

---

### Task B5: Update app metadata title

**Files:**
- Modify: `src/app/layout.tsx:9`
- Test: none (trivial copy change verified by build)

- [ ] **Step 1: Change the title**

In `src/app/layout.tsx`, replace:

```ts
export const metadata = { title: "CEO Command Center" };
```

with:

```ts
export const metadata = { title: "AIYA Designs — Command Center" };
```

- [ ] **Step 2: Commit**

```bash
git add src/app/layout.tsx
git commit -m "chore(ui): set app title to AIYA Designs"
```

---

## Phase C — Live panels

### Task C1: KPI ticker row (live metals/crypto/FX + honest diamond placeholders)

**Files:**
- Create: `src/components/market/KpiTicker.tsx`
- Test: `test/components/market/KpiTicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/market/KpiTicker.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { KpiTicker } from "@/components/market/KpiTicker";
import type { Quote } from "@/lib/market/types";

const q = (symbol: string, display: string, price: number): Quote => ({
  symbol, assetClass: "commodity", display, currency: "USD",
  price, changeAbs: 1, changePct: 0.85, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
});

describe("KpiTicker", () => {
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        XAU: q("XAU", "Gold 24K", 2386.45),
        XAG: q("XAG", "Silver", 31.25),
        XPT: q("XPT", "Platinum", 1021.3),
        BTC: q("BTC", "Bitcoin", 67450.2),
        USDAED: q("USDAED", "USD/AED", 3.6725),
        EURUSD: q("EURUSD", "EUR/USD", 1.085),
      },
    }));

  it("renders a live card with a freshness dot for each priced symbol", () => {
    render(<KpiTicker />);
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getByText(/67450\.20/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(6);
  });

  it("shows honest placeholders for the diamond indices (no fake numbers)", () => {
    render(<KpiTicker />);
    const natural = screen.getByTestId("kpi-natural-diamond");
    expect(within(natural).getByText("—")).toBeInTheDocument();
    expect(within(natural).getByText(/awaiting price list/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/market/KpiTicker.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/components/market/KpiTicker.tsx`:

```tsx
"use client";
import { useQuotes, selectQuote } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const LIVE_CARDS: { symbol: string; label: string; decimals: number }[] = [
  { symbol: "XAU", label: "Gold 24K (USD/oz)", decimals: 2 },
  { symbol: "XAG", label: "Silver (USD/oz)", decimals: 2 },
  { symbol: "XPT", label: "Platinum (USD/oz)", decimals: 2 },
  { symbol: "BTC", label: "Bitcoin (BTC/USD)", decimals: 2 },
  { symbol: "USDAED", label: "USD / AED", decimals: 4 },
  { symbol: "EURUSD", label: "EUR / USD", decimals: 4 },
];

function LiveCard({ symbol, label, decimals }: { symbol: string; label: string; decimals: number }) {
  const quote = useQuotes(selectQuote(symbol));
  const up = (quote?.changePct ?? 0) >= 0;
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-text/50">
        <span>{label}</span>
        {quote && <FreshnessDot freshness={quote.freshness} />}
      </div>
      <div className="font-mono text-lg text-text">
        {quote ? `$${quote.price.toFixed(decimals)}` : "—"}
      </div>
      <div className={`text-xs ${up ? "text-ok" : "text-bad"}`}>
        {quote ? `${up ? "▲" : "▼"} ${Math.abs(quote.changePct).toFixed(2)}%` : ""}
      </div>
    </div>
  );
}

function DiamondPlaceholder({ testid, label }: { testid: string; label: string }) {
  return (
    <div data-testid={testid} className="rounded-lg bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text/50">{label}</div>
      <div className="font-mono text-lg text-text/40">—</div>
      <div className="text-[10px] italic text-text/30">awaiting price list</div>
    </div>
  );
}

export function KpiTicker() {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <LiveCard {...LIVE_CARDS[0]} />
      <DiamondPlaceholder testid="kpi-natural-diamond" label="Natural Diamond Index" />
      <DiamondPlaceholder testid="kpi-lab-diamond" label="Lab Diamond Index" />
      {LIVE_CARDS.slice(1).map((c) => (
        <LiveCard key={c.symbol} {...c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/market/KpiTicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/market/KpiTicker.tsx test/components/market/KpiTicker.test.tsx
git commit -m "feat(dashboard): live KPI ticker row with honest diamond placeholders"
```

---

### Task C2: Market Intelligence panel (live metals + crypto rows)

**Files:**
- Create: `src/components/market/MarketIntelligencePanel.tsx`
- Test: `test/components/market/MarketIntelligencePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/market/MarketIntelligencePanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import type { Quote } from "@/lib/market/types";

const q = (symbol: string, display: string, price: number, klass: Quote["assetClass"]): Quote => ({
  symbol, assetClass: klass, display, currency: "USD",
  price, changeAbs: 1, changePct: 1.0, asOf: Date.now(),
  source: "twelvedata", freshness: "live",
});

describe("MarketIntelligencePanel", () => {
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        XAU: q("XAU", "Gold", 2386.45, "commodity"),
        XAG: q("XAG", "Silver", 31.25, "commodity"),
        XPT: q("XPT", "Platinum", 1021.3, "commodity"),
        BTC: q("BTC", "Bitcoin", 67450.2, "crypto"),
        ETH: q("ETH", "Ethereum", 3412.89, "crypto"),
      },
    }));

  it("shows live metals rows with freshness dots by default", () => {
    render(<MarketIntelligencePanel />);
    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByText(/2386\.45/)).toBeInTheDocument();
    expect(screen.getAllByTestId("freshness-dot").length).toBeGreaterThanOrEqual(1);
  });

  it("switches to crypto rows", () => {
    render(<MarketIntelligencePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Crypto" }));
    expect(screen.getByText("Bitcoin")).toBeInTheDocument();
  });

  it("labels the Diamonds tab as not yet wired", () => {
    render(<MarketIntelligencePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Diamonds" }));
    expect(screen.getByText(/not yet wired/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/market/MarketIntelligencePanel.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/components/market/MarketIntelligencePanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { useQuotes } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const TABS = ["Gold", "Metals", "Crypto", "Diamonds", "Gas", "News"] as const;
type Tab = (typeof TABS)[number];

const ROWS: Record<string, string[]> = {
  Gold: ["XAU"],
  Metals: ["XAU", "XAG", "XPT"],
  Crypto: ["BTC", "ETH"],
};

function LiveRows({ symbols }: { symbols: string[] }) {
  const bySymbol = useQuotes((s) => s.bySymbol);
  return (
    <table className="w-full text-xs">
      <tbody>
        {symbols.map((sym) => {
          const q = bySymbol[sym];
          const up = (q?.changePct ?? 0) >= 0;
          return (
            <tr key={sym} className="border-b border-white/5">
              <td className="py-1 text-text/80">{q?.display ?? sym}</td>
              <td className="py-1 text-right font-mono">{q ? `$${q.price.toFixed(2)}` : "—"}</td>
              <td className={`py-1 text-right ${up ? "text-ok" : "text-bad"}`}>
                {q ? `${up ? "▲" : "▼"} ${Math.abs(q.changePct).toFixed(2)}%` : ""}
              </td>
              <td className="py-1 pl-2 text-right">{q && <FreshnessDot freshness={q.freshness} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MarketIntelligencePanel() {
  const [tab, setTab] = useState<Tab>("Gold");
  const liveSymbols = ROWS[tab];
  return (
    <Panel title="Market Intelligence" state="ready">
      <div className="mb-2 flex gap-3 text-xs">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={t === tab ? "text-gold" : "text-text/50"}
          >
            {t}
          </button>
        ))}
      </div>
      {liveSymbols ? (
        <LiveRows symbols={liveSymbols} />
      ) : (
        <div className="py-4 text-sm italic text-text/30">Not yet wired — future slice</div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/market/MarketIntelligencePanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/market/MarketIntelligencePanel.tsx test/components/market/MarketIntelligencePanel.test.tsx
git commit -m "feat(dashboard): Market Intelligence panel with live metals/crypto tabs"
```

---

### Task C3: Price Trend Analytics panel (real Gold + BTC series)

**Files:**
- Create: `src/components/market/PriceTrendPanel.tsx`
- Test: `test/components/market/PriceTrendPanel.test.tsx`

Recharts renders nothing measurable in jsdom, so the test asserts data fetching + range controls, not pixels. We expose the fetched series via `data-testid` counts.

- [ ] **Step 1: Write the failing test**

Create `test/components/market/PriceTrendPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";

afterEach(() => vi.unstubAllGlobals());

describe("PriceTrendPanel", () => {
  it("fetches Gold and BTC history and exposes the loaded ranges", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const symbol = new URL(url, "http://localhost").searchParams.get("symbol");
      return {
        ok: true,
        json: async () => ({ symbol, points: [1, 2, 3], freshness: "live" }),
      } as Response;
    });
    render(<PriceTrendPanel />);
    await waitFor(() => expect(screen.getByTestId("trend-loaded")).toBeInTheDocument());
    expect(calls.some((u) => u.includes("symbol=XAU"))).toBe(true);
    expect(calls.some((u) => u.includes("symbol=BTC"))).toBe(true);
  });

  it("re-fetches when the range changes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => ({ symbol: "BTC", points: [1], freshness: "live" }) } as Response;
    });
    render(<PriceTrendPanel />);
    await waitFor(() => expect(screen.getByTestId("trend-loaded")).toBeInTheDocument());
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(calls.some((u) => u.includes("range=1Y"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/market/PriceTrendPanel.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/components/market/PriceTrendPanel.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Panel } from "@/components/Panel";
import { FreshnessDot } from "@/components/FreshnessDot";
import type { Freshness } from "@/lib/market/types";

const RANGES = ["1D", "7D", "1M", "3M", "1Y", "ALL"] as const;
type Range = (typeof RANGES)[number];

interface Series { points: number[]; freshness: Freshness }

async function load(symbol: string, range: Range): Promise<Series> {
  const res = await fetch(`/api/history?symbol=${symbol}&range=${range}`, { cache: "no-store" });
  if (!res.ok) return { points: [], freshness: "stale" };
  const data = (await res.json()) as Series;
  return { points: data.points ?? [], freshness: data.freshness };
}

export function PriceTrendPanel() {
  const [range, setRange] = useState<Range>("1M");
  const [gold, setGold] = useState<Series | null>(null);
  const [btc, setBtc] = useState<Series | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([load("XAU", range), load("BTC", range)]).then(([g, b]) => {
      if (cancelled) return;
      setGold(g);
      setBtc(b);
    });
    return () => { cancelled = true; };
  }, [range]);

  const loaded = gold != null && btc != null;
  const data = loaded
    ? gold!.points.map((g, i) => ({ i, gold: g, btc: btc!.points[i] ?? null }))
    : [];

  return (
    <Panel title="Price Trend Analytics" state="ready">
      <div className="mb-2 flex items-center gap-3 text-xs">
        {RANGES.map((r) => (
          <button key={r} onClick={() => setRange(r)} className={r === range ? "text-gold" : "text-text/50"}>
            {r}
          </button>
        ))}
        {loaded && (
          <span className="ml-auto flex items-center gap-1 text-text/50">
            Gold <FreshnessDot freshness={gold!.freshness} />
            BTC <FreshnessDot freshness={btc!.freshness} />
          </span>
        )}
      </div>
      {loaded && <span data-testid="trend-loaded" className="sr-only">loaded</span>}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="i" hide />
            <YAxis yAxisId="gold" hide domain={["auto", "auto"]} />
            <YAxis yAxisId="btc" orientation="right" hide domain={["auto", "auto"]} />
            <Tooltip />
            <Line yAxisId="gold" type="monotone" dataKey="gold" stroke="hsl(var(--gold))" dot={false} isAnimationActive={false} />
            <Line yAxisId="btc" type="monotone" dataKey="btc" stroke="hsl(var(--accent-blue))" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/market/PriceTrendPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/market/PriceTrendPanel.tsx test/components/market/PriceTrendPanel.test.tsx
git commit -m "feat(dashboard): Price Trend panel with real Gold/BTC history"
```

---

### Task C4: Unit Converter panel (broad currency + live metals)

**Files:**
- Create: `src/components/converter/UnitConverterPanel.tsx`
- Test: `test/components/converter/UnitConverterPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/converter/UnitConverterPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useQuotes } from "@/store/quotes";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import type { Quote } from "@/lib/market/types";

afterEach(() => vi.unstubAllGlobals());

const gold: Quote = {
  symbol: "XAU", assetClass: "commodity", display: "Gold", currency: "USD",
  price: 2400, changeAbs: 0, changePct: 0, asOf: Date.now(), source: "twelvedata", freshness: "live",
};

describe("UnitConverterPanel", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: gold } }));

  it("loads a broad currency list (30+) into the selectors", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        currencies: Object.fromEntries(
          Array.from({ length: 31 }, (_, i) => [`C${i}`, `Currency ${i}`]),
        ),
      }),
    } as Response));
    render(<UnitConverterPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("from-currency").querySelectorAll("option").length).toBeGreaterThanOrEqual(30),
    );
  });

  it("converts metal weight to USD market value using the live quote", () => {
    // The default Currency tab fires /api/convert on mount; stub it so the test is quiet.
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ currencies: {} }) } as Response));
    render(<UnitConverterPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Metals" }));
    // 1 troy oz of gold at $2400 => $2400 market value
    expect(screen.getByTestId("metal-value").textContent).toContain("2400");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/converter/UnitConverterPanel.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/components/converter/UnitConverterPanel.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";
import { useQuotes, selectQuote } from "@/store/quotes";

const TABS = ["Metals", "Currency", "Weight", "Diamonds", "Gas"] as const;
type Tab = (typeof TABS)[number];

// Weight conversion to grams (troy ounce is the precious-metals standard).
const TO_GRAMS: Record<string, number> = {
  "Troy Ounce": 31.1035, Gram: 1, Kilogram: 1000, Ounce: 28.3495, Carat: 0.2,
};
const METALS: Record<string, string> = { Gold: "XAU", Silver: "XAG", Platinum: "XPT" };

function MetalsTab() {
  const [metal, setMetal] = useState("Gold");
  const [unit, setUnit] = useState("Troy Ounce");
  const [amount, setAmount] = useState(1);
  const quote = useQuotes(selectQuote(METALS[metal]));
  const grams = amount * TO_GRAMS[unit];
  const troyOz = grams / TO_GRAMS["Troy Ounce"];
  const value = quote ? troyOz * quote.price : null;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <select aria-label="metal" value={metal} onChange={(e) => setMetal(e.target.value)} className="bg-bg p-1">
          {Object.keys(METALS).map((m) => <option key={m}>{m}</option>)}
        </select>
        <input aria-label="amount" type="number" value={amount}
          onChange={(e) => setAmount(Number(e.target.value))} className="w-20 bg-bg p-1" />
        <select aria-label="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="bg-bg p-1">
          {Object.keys(TO_GRAMS).map((u) => <option key={u}>{u}</option>)}
        </select>
      </div>
      <div className="text-text/70">{grams.toFixed(3)} g</div>
      <div data-testid="metal-value" className="font-mono text-lg text-gold">
        {value != null ? `$${value.toFixed(2)}` : "—"}
      </div>
    </div>
  );
}

function CurrencyTab() {
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EUR");
  const [amount, setAmount] = useState(1000);
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    void fetch("/api/convert")
      .then((r) => r.json())
      .then((d) => setCurrencies(d.currencies ?? {}));
  }, []);

  useEffect(() => {
    void fetch(`/api/convert?from=${from}&to=${to}&amount=${amount}`)
      .then((r) => r.json())
      .then((d) => setResult(d.result ?? null));
  }, [from, to, amount]);

  const codes = Object.keys(currencies);
  return (
    <div className="space-y-2 text-xs">
      <div className="flex gap-2">
        <input aria-label="currency-amount" type="number" value={amount}
          onChange={(e) => setAmount(Number(e.target.value))} className="w-24 bg-bg p-1" />
        <select data-testid="from-currency" aria-label="from-currency" value={from}
          onChange={(e) => setFrom(e.target.value)} className="bg-bg p-1">
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="self-center">→</span>
        <select data-testid="to-currency" aria-label="to-currency" value={to}
          onChange={(e) => setTo(e.target.value)} className="bg-bg p-1">
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="font-mono text-lg text-gold">
        {result != null ? result.toFixed(2) : "—"} {to}
      </div>
      <div className="text-[10px] italic text-text/40">ECB daily reference rates</div>
    </div>
  );
}

export function UnitConverterPanel() {
  const [tab, setTab] = useState<Tab>("Currency");
  return (
    <Panel title="Unit Converter (Advanced)" state="ready">
      <div className="mb-2 flex gap-3 text-xs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={t === tab ? "text-gold" : "text-text/50"}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Metals" && <MetalsTab />}
      {tab === "Currency" && <CurrencyTab />}
      {tab !== "Metals" && tab !== "Currency" && (
        <div className="py-4 text-sm italic text-text/30">Not yet wired — future slice</div>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/converter/UnitConverterPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/converter/UnitConverterPanel.tsx test/components/converter/UnitConverterPanel.test.tsx
git commit -m "feat(dashboard): unit converter with broad currency + live metals tabs"
```

---

### Task C5: Clock + calendar widget

**Files:**
- Create: `src/components/dashboard/ClockCalendar.tsx`
- Test: `test/components/dashboard/ClockCalendar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/dashboard/ClockCalendar.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";

beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2025-05-08T10:45:00")));
afterEach(() => vi.useRealTimers());

describe("ClockCalendar", () => {
  it("renders the current time and the month grid", () => {
    render(<ClockCalendar />);
    expect(screen.getByTestId("clock").textContent).toMatch(/10:45/);
    expect(screen.getByText(/MAY 2025/i)).toBeInTheDocument();
    // Day 8 is present in the grid.
    expect(screen.getByText("8")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/dashboard/ClockCalendar.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/components/dashboard/ClockCalendar.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Panel } from "@/components/Panel";

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function ClockCalendar() {
  const now = useNow();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <Panel title="Clock & Calendar" state="ready">
      <div data-testid="clock" className="font-mono text-2xl text-text">{time}</div>
      <div className="mb-2 text-xs text-text/50">{monthLabel}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {days.map((d) => (
          <span key={d} className={d === today ? "rounded bg-gold/20 text-gold" : "text-text/60"}>
            {d}
          </span>
        ))}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/components/dashboard/ClockCalendar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ClockCalendar.tsx test/components/dashboard/ClockCalendar.test.tsx
git commit -m "feat(dashboard): live clock + month calendar widget"
```

---

## Phase D — Assembly & verification

### Task D1: Assemble the mockup-1 dashboard grid

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/dashboard/BusinessPlaceholder.tsx`
- Test: `test/components/dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/components/dashboard/Dashboard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DashboardGrid } from "@/app/DashboardGrid";

// PriceTrendPanel and UnitConverterPanel fetch on mount; stub so the grid test is quiet.
beforeEach(() =>
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ points: [], freshness: "live", currencies: {} }),
  } as Response)));
afterEach(() => vi.unstubAllGlobals());

describe("DashboardGrid", () => {
  it("renders the live panels and honest business placeholders", () => {
    render(<DashboardGrid />);
    // Live panels present:
    expect(screen.getByText("Market Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Price Trend Analytics")).toBeInTheDocument();
    expect(screen.getByText("Unit Converter (Advanced)")).toBeInTheDocument();
    // Business placeholders present and honest:
    const inventory = screen.getByTestId("panel-inventory-overview");
    expect(within(inventory).getByText(/not yet wired/i)).toBeInTheDocument();
    for (const id of [
      "panel-orders-pipeline", "panel-portfolio-snapshot", "panel-financial-overview",
      "panel-crypto-wallet", "panel-tradenet-exchange", "panel-ai-insights",
      "panel-todays-schedule", "panel-social-inbox",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/components/dashboard/Dashboard.test.tsx`
Expected: FAIL — `@/app/DashboardGrid` not found.

- [ ] **Step 3: Create the business placeholder component**

Create `src/components/dashboard/BusinessPlaceholder.tsx`:

```tsx
import { Panel } from "@/components/Panel";

export function BusinessPlaceholder({ title, testid }: { title: string; testid: string }) {
  return (
    <div data-testid={testid}>
      <Panel title={title} state="unwired" />
    </div>
  );
}
```

- [ ] **Step 4: Create the grid (client component, extracted for testability)**

Create `src/app/DashboardGrid.tsx`:

```tsx
"use client";
import { KpiTicker } from "@/components/market/KpiTicker";
import { MarketIntelligencePanel } from "@/components/market/MarketIntelligencePanel";
import { PriceTrendPanel } from "@/components/market/PriceTrendPanel";
import { UnitConverterPanel } from "@/components/converter/UnitConverterPanel";
import { ClockCalendar } from "@/components/dashboard/ClockCalendar";
import { BusinessPlaceholder } from "@/components/dashboard/BusinessPlaceholder";

export function DashboardGrid() {
  return (
    <div className="space-y-3" data-testid="dashboard-root">
      <KpiTicker />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <div className="xl:col-span-1"><MarketIntelligencePanel /></div>
        <div className="xl:col-span-2"><PriceTrendPanel /></div>
        <div className="xl:col-span-1"><ClockCalendar /></div>

        <BusinessPlaceholder title="AI Insights" testid="panel-ai-insights" />
        <BusinessPlaceholder title="Today's Schedule" testid="panel-todays-schedule" />
        <BusinessPlaceholder title="Inventory Overview" testid="panel-inventory-overview" />
        <BusinessPlaceholder title="TradeNet Exchange" testid="panel-tradenet-exchange" />

        <BusinessPlaceholder title="Orders & Pipeline" testid="panel-orders-pipeline" />
        <BusinessPlaceholder title="Portfolio Snapshot" testid="panel-portfolio-snapshot" />
        <div className="xl:col-span-1"><UnitConverterPanel /></div>
        <BusinessPlaceholder title="Crypto Wallet" testid="panel-crypto-wallet" />

        <div className="xl:col-span-2"><BusinessPlaceholder title="Financial Overview" testid="panel-financial-overview" /></div>
        <div className="xl:col-span-2"><BusinessPlaceholder title="Social & Inbox" testid="panel-social-inbox" /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the grid test to verify it passes**

Run: `npx vitest run test/components/dashboard/Dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the grid into the page**

Replace `src/app/page.tsx` with:

```tsx
import { Shell } from "@/components/dashboard/Shell";
import { QuotesProvider } from "@/components/dashboard/QuotesProvider";
import { TickerStrip } from "@/components/market/TickerStrip";
import { DashboardGrid } from "./DashboardGrid";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <QuotesProvider>
      <Shell ticker={<TickerStrip />}>
        <DashboardGrid />
      </Shell>
    </QuotesProvider>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/app/DashboardGrid.tsx src/components/dashboard/BusinessPlaceholder.tsx test/components/dashboard/Dashboard.test.tsx
git commit -m "feat(dashboard): assemble AIYA mockup-1 grid (live panels + honest placeholders)"
```

---

### Task D2: Header ticker shows AIYA-relevant symbols

**Files:**
- Modify: `src/components/market/TickerStrip.tsx:5`
- Test: `test/components/market/TickerStrip.test.tsx`

The existing test asserts the strip shows both a `live` and a `simulated` dot. The current seed uses `SPX` (simulated), which the new AIYA symbol set won't render — so update the seed to a symbol that *is* in the set before changing the component.

- [ ] **Step 1: Update the test seed to AIYA symbols**

In `test/components/market/TickerStrip.test.tsx`, the `sim` quote is `SPX`. Replace the `beforeEach` line so the simulated quote is `XAU` (which is in the new ticker set):

```ts
  beforeEach(() =>
    useQuotes.setState({
      bySymbol: {
        BTC: live,
        XAU: { ...sim, symbol: "XAU", assetClass: "commodity", display: "Gold" },
      },
    }));
```

- [ ] **Step 2: Update the ticker symbols**

In `src/components/market/TickerStrip.tsx`, replace the `TICKER` constant:

```ts
const TICKER = ["XAU", "XAG", "XPT", "BTC", "USDAED", "EURUSD"];
```

- [ ] **Step 3: Run the ticker test to confirm green**

Run: `npx vitest run test/components/market/TickerStrip.test.tsx`
Expected: PASS — `XAU` renders a `simulated` dot and `BTC` a `live` dot.

- [ ] **Step 4: Commit**

```bash
git add src/components/market/TickerStrip.tsx test/components/market/TickerStrip.test.tsx
git commit -m "feat(dashboard): header ticker shows AIYA headline instruments"
```

---

### Task D3: Render-isolation guard for the KPI ticker

**Files:**
- Test: `test/perf/kpi-render-isolation.test.tsx`

Proves a single price tick re-renders only the affected KPI card (spec §9.1).

- [ ] **Step 1: Write the test**

Create `test/perf/kpi-render-isolation.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useQuotes, selectQuote } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";
import type { Quote } from "@/lib/market/types";

const mk = (symbol: string, price: number): Quote => ({
  symbol, assetClass: "commodity", display: symbol, currency: "USD",
  price, changeAbs: 0, changePct: 0, asOf: 1, source: "twelvedata", freshness: "live",
});

// Mirror of the KpiTicker LiveCard subscription contract.
function Card({ symbol, onRender }: { symbol: string; onRender: () => void }) {
  const q = useQuotes(selectQuote(symbol));
  onRender();
  return <span>{q?.price}<FreshnessDot freshness={q?.freshness ?? "live"} /></span>;
}

describe("KPI render isolation", () => {
  beforeEach(() => useQuotes.setState({ bySymbol: { XAU: mk("XAU", 2400), BTC: mk("BTC", 67000) } }));

  it("a Gold tick does not re-render the Bitcoin card", () => {
    let gold = 0, btc = 0;
    render(<><Card symbol="XAU" onRender={() => gold++} /><Card symbol="BTC" onRender={() => btc++} /></>);
    const baseBtc = btc;
    act(() => { useQuotes.getState().ingest([mk("XAU", 2450)]); });
    expect(gold).toBeGreaterThan(1);
    expect(btc).toBe(baseBtc);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/perf/kpi-render-isolation.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/perf/kpi-render-isolation.test.tsx
git commit -m "test(perf): assert KPI ticker render isolation on single tick"
```

---

### Task D4: Full suite + typecheck + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS (new + existing). Fix any regressions before continuing.

- [ ] **Step 2: Typecheck / build**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`, log in, and confirm against mockup 1:
- KPI ticker shows live Gold/Silver/Platinum/BTC/USD-AED/EUR-USD with freshness dots; diamond cards read "—" with "awaiting price list".
- Market Intelligence tabs switch; metals/crypto rows are live; Diamonds/Gas/News say "not yet wired".
- Price Trend draws Gold + BTC lines; range buttons re-fetch.
- Converter: Currency tab lists 30+ currencies and converts; Metals tab shows live USD value.
- All business panels render the honest "not yet wired" state — no fake numbers anywhere.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: slice 1a verification fixes"
```

(Skip if there were no fixes.)

---

## Done criteria

- All new tests green; full suite green; `tsc --noEmit` clean.
- Dashboard visually matches mockup 1's structure with AIYA branding.
- Every live value carries an honest freshness dot; every unwired business panel is clearly labeled; **no fabricated numbers**.
- Slice 1b (business data: inventory, orders, portfolio, financial, crypto-wallet balances, diamond/gem price lists) is the next spec.
