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

  it("reports rate 0 (not NaN) for a zero amount", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ rates: { INR: 0 } }),
    } as Response));
    const r = await convertCurrency("USD", "INR", 0);
    expect(r.result).toBe(0);
    expect(Number.isNaN(r.rate)).toBe(false);
    expect(r.rate).toBe(0);
  });
});
