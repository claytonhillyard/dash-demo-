import type { ReactNode } from "react";
import { FreshnessDot, type Freshness } from "./FreshnessDot";

export type PanelState = "loading" | "ready" | "empty" | "error" | "unwired";

export function Panel({
  title, state, children, freshness, errorMessage,
}: {
  title: string;
  state: PanelState;
  children?: ReactNode;
  freshness?: Freshness;
  errorMessage?: string;
}) {
  return (
    <section className="rounded-lg bg-surface p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-text/70">{title}</h3>
        {freshness && <FreshnessDot freshness={freshness} />}
      </header>
      {state === "loading" && <div className="animate-pulse text-text/40">Loading…</div>}
      {state === "ready" && children}
      {state === "empty" && <div className="text-text/40">No data</div>}
      {state === "error" && <div className="text-bad text-sm">{errorMessage}</div>}
      {state === "unwired" && (
        <div className="text-text/30 text-sm italic">Not yet wired — future slice</div>
      )}
    </section>
  );
}
