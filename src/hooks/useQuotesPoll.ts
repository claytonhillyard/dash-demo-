"use client";
import { useEffect } from "react";
import { useQuotes } from "@/store/quotes";
import { useSetting } from "@/hooks/useSetting";

export function useQuotesPoll() {
  const refreshSeconds = useSetting("refreshSeconds");
  const ingest = useQuotes((s) => s.ingest);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) return;
        const { quotes } = await res.json();
        if (!cancelled) ingest(quotes);
      } catch {
        // transient; next tick retries
      }
    }
    void tick();
    const id = setInterval(tick, refreshSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshSeconds, ingest]);
}
