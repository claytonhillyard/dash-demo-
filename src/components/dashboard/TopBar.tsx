import type { ReactNode } from "react";
import { CustomizeButton } from "./CustomizeButton";

export function TopBar({ ticker, onMenuClick }: { ticker?: ReactNode; onMenuClick?: () => void }) {
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface/80 px-4 py-2 backdrop-blur">
      {onMenuClick && (
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onMenuClick}
          className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text/70 hover:bg-surface-2 hover:text-gold md:hidden"
        >
          <span aria-hidden className="text-lg leading-none">☰</span>
        </button>
      )}
      <div className="leading-tight">
        <div className="flex items-center gap-1.5 text-sm font-medium text-text">
          Good Morning, AIYA
          <span className="text-gold" aria-hidden>
            ♛
          </span>
        </div>
        <div className="text-xs text-text/50">
          Here&apos;s what&apos;s happening with your business today.
        </div>
      </div>

      {/* Search */}
      <label className="ml-4 hidden min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-text/40 md:flex">
        <span aria-hidden>⌕</span>
        <input
          type="text"
          placeholder="Search anything…"
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent text-xs text-text placeholder:text-text/30 focus:outline-none"
        />
      </label>

      <div className="ml-auto flex items-center gap-3">
        <CustomizeButton />
        <div className="hidden items-center gap-3 text-text/40 lg:flex" aria-hidden>
          <span className="relative">
            🔔
            <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-gold" />
          </span>
          <span>✉</span>
        </div>
        <div className="hidden h-6 w-px bg-border lg:block" />
        {ticker}
        <div className="flex items-center gap-2 rounded-full border border-border bg-surface-2/60 py-1 pl-1 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/15 text-[10px] font-semibold text-gold">
            AD
          </span>
          <span className="hidden text-xs text-text/70 sm:block">AIYA Designs</span>
        </div>
      </div>
    </header>
  );
}
