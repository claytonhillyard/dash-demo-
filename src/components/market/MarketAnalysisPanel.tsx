"use client";
import { useState } from "react";
import { Panel } from "@/components/Panel";
import { MiniCards } from "./MiniCards";
import { TopStocksTable } from "./TopStocksTable";

const TABS = ["Overview", "Indices", "Commodities", "Crypto", "Forex", "Bonds"] as const;

export function MarketAnalysisPanel() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  return (
    <Panel title="Market Analysis" state="ready">
      <div className="mb-2 flex gap-2 text-xs">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={t === tab ? "text-gold" : "text-text/50"}>{t}</button>
        ))}
      </div>
      <MiniCards />
      <div className="mt-3"><TopStocksTable /></div>
    </Panel>
  );
}
