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
