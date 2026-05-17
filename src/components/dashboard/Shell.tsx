"use client";
import { type ReactNode, useEffect } from "react";
import { useSettings } from "@/store/settings";
import { Nav } from "./Nav";
import { TopBar } from "./TopBar";
import { RightRail } from "./RightRail";
import { FooterBar } from "./FooterBar";
import { SettingsPanel } from "./SettingsPanel";

export function Shell({ children, ticker }: { children: ReactNode; ticker?: ReactNode }) {
  const { amoled, reduceMotion } = useSettings((s) => s.settings);
  useEffect(() => {
    document.documentElement.dataset.amoled = String(amoled);
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [amoled, reduceMotion]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar ticker={ticker} />
      <div className="flex flex-1">
        <Nav />
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <RightRail><SettingsPanel /></RightRail>
      </div>
      <FooterBar />
    </div>
  );
}
