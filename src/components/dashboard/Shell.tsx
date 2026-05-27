"use client";
import { type ReactNode, useEffect } from "react";
import { useSettings } from "@/store/settings";
import { Nav } from "./Nav";
import { TopBar } from "./TopBar";
import { RightRail } from "./RightRail";
import { FooterBar } from "./FooterBar";
import { SettingsPanel } from "./SettingsPanel";
import { DemoBanner } from "./DemoBanner";

export function Shell({ children, ticker }: { children: ReactNode; ticker?: ReactNode }) {
  const { amoled, reduceMotion } = useSettings((s) => s.settings);
  useEffect(() => {
    document.documentElement.dataset.amoled = String(amoled);
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [amoled, reduceMotion]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Nav />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <TopBar ticker={ticker} />
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <FooterBar />
      </div>
      <RightRail><SettingsPanel /></RightRail>
    </div>
  );
}
