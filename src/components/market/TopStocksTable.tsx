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
