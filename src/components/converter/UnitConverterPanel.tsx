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
