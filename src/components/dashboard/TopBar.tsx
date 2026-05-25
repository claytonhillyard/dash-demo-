import type { ReactNode } from "react";

export function TopBar({ ticker }: { ticker?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 bg-surface px-4 py-2">
      <div className="flex flex-col leading-tight">
        <span className="font-display text-gold text-lg tracking-[0.3em]">AIYA DESIGNS</span>
        <span className="text-text/40 text-[10px] tracking-wider">
          Crafting Brilliance. Building Trust.
        </span>
      </div>
      <div className="ml-2">
        <div className="text-sm text-text">Good Morning, AIYA</div>
        <div className="text-xs text-text/50">Here&apos;s what&apos;s happening with your business today.</div>
      </div>
      <div className="ml-auto flex items-center gap-4">{ticker}</div>
    </header>
  );
}
