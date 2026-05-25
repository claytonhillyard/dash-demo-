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
