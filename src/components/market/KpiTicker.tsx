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

function LiveCard({
  symbol, label, decimals, featured,
}: { symbol: string; label: string; decimals: number; featured?: boolean }) {
  const quote = useQuotes(selectQuote(symbol));
  const up = (quote?.changePct ?? 0) >= 0;
  return (
    <div
      className={`surface-card relative overflow-hidden rounded-xl px-3 py-2 ${
        featured ? "ring-1 ring-gold/30" : ""
      }`}
    >
      {featured && (
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      )}
      <div className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-wider text-text/45">
        <span className="truncate">{label}</span>
        {quote && <FreshnessDot freshness={quote.freshness} />}
      </div>
      <div className={`font-mono text-lg ${featured ? "text-foil" : "text-text"}`}>
        {quote ? `$${quote.price.toFixed(decimals)}` : "—"}
      </div>
      <div className={`flex items-center gap-1 text-xs ${up ? "text-ok" : "text-bad"}`}>
        {quote ? `${up ? "▲" : "▼"} ${Math.abs(quote.changePct).toFixed(2)}%` : ""}
      </div>
    </div>
  );
}

function DiamondPlaceholder({ testid, label }: { testid: string; label: string }) {
  return (
    <div
      data-testid={testid}
      className="surface-card rounded-xl border-dashed px-3 py-2 opacity-80"
    >
      <div className="text-[9px] uppercase tracking-wider text-text/45">{label}</div>
      <div className="font-mono text-lg text-text/35">—</div>
      <div className="text-[9px] italic text-text/30">awaiting price list</div>
    </div>
  );
}

export function KpiTicker() {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <LiveCard {...LIVE_CARDS[0]} featured />
      <DiamondPlaceholder testid="kpi-natural-diamond" label="Natural Diamond Index" />
      <DiamondPlaceholder testid="kpi-lab-diamond" label="Lab Diamond Index" />
      {LIVE_CARDS.slice(1).map((c) => (
        <LiveCard key={c.symbol} {...c} />
      ))}
    </div>
  );
}
