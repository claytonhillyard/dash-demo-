import type { ReactNode } from "react";
export function TopBar({ ticker }: { ticker?: ReactNode }) {
  return (
    <header className="flex items-center gap-4 bg-surface px-4 py-2">
      <span className="font-display text-gold text-lg tracking-widest">CHILLY.AI</span>
      <span className="text-text/60 text-sm">CEO Command Center</span>
      <div className="ml-auto flex items-center gap-4">{ticker}</div>
    </header>
  );
}
