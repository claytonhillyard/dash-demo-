"use client";
import { type ReactNode, useEffect, useState } from "react";
import { useSettings } from "@/store/settings";
import { Nav } from "./Nav";
import { TopBar } from "./TopBar";
import { RightRail } from "./RightRail";
import { FooterBar } from "./FooterBar";
import { SettingsPanel } from "./SettingsPanel";
import { DemoBanner } from "./DemoBanner";

export function Shell({ children, ticker }: { children: ReactNode; ticker?: ReactNode }) {
  const { amoled, reduceMotion } = useSettings((s) => s.settings);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.amoled = String(amoled);
    document.documentElement.dataset.reduceMotion = String(reduceMotion);
  }, [amoled, reduceMotion]);

  // Close the mobile drawer on Escape, so keyboard users have an exit.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — hidden on mobile in favor of the drawer below. */}
      <div className="hidden md:flex"><Nav /></div>

      {/* Mobile drawer. Clicks bubble up to the panel container, which closes
          the drawer — so tapping a nav link navigates AND closes naturally. */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setNavOpen(false)}
          />
          <div
            className="relative h-full w-72 max-w-[80vw] overflow-y-auto"
            onClick={() => setNavOpen(false)}
          >
            <Nav />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <TopBar ticker={ticker} onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-auto p-4">{children}</main>
        <FooterBar />
      </div>

      <div className="hidden md:flex"><RightRail><SettingsPanel /></RightRail></div>
    </div>
  );
}
