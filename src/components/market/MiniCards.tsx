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
