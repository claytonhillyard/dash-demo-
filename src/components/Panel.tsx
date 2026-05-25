import type { ReactNode } from "react";
import { FreshnessDot, type Freshness } from "./FreshnessDot";

export type PanelState = "loading" | "ready" | "empty" | "error" | "unwired";

export function Panel({
  title, state, children, freshness, errorMessage, action,
}: {
  title: string;
  state: PanelState;
  children?: ReactNode;
  freshness?: Freshness;
  errorMessage?: string;
  /** Optional right-aligned header affordance, e.g. a "View All" link. */
  action?: ReactNode;
}) {
  return (
    <section className="surface-card flex h-full flex-col rounded-xl p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-text/70">
          {title}
        </h3>
        <div className="flex items-center gap-2">
          {action}
          {freshness && <FreshnessDot freshness={freshness} />}
        </div>
      </header>
      <div className="-mx-3 mb-2 h-px rule-gold" />
      {state === "loading" && <div className="animate-pulse text-text/40">Loading…</div>}
      {state === "ready" && children}
      {state === "empty" && <div className="text-text/40">No data</div>}
      {state === "error" && <div className="text-sm text-bad">{errorMessage}</div>}
      {state === "unwired" && (
        <div className="flex flex-1 items-center justify-center py-6 text-center">
          <div>
            <div className="text-xs italic text-text/30">Not yet wired</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-widest text-text/20">
              Coming in a future slice
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
