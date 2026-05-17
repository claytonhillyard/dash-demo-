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
