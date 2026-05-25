"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { useQuotes } from "@/store/quotes";
import { FreshnessDot } from "@/components/FreshnessDot";

const TABS = ["Gold", "Metals", "Crypto", "Diamonds", "Gas", "News"] as const;
type Tab = (typeof TABS)[number];

const ROWS: Record<string, string[]> = {
  "Gold": ["XAU"],
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
