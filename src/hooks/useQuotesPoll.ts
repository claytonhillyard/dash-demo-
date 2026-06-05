"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { useQuotes } from "@/store/quotes";
import { useSetting } from "@/hooks/useSetting";

/**
 * Threshold for capturing sustained poll failure to Sentry.
 * At the default 15s refresh, 5 ticks = 75s of sustained failure — long
 * enough to filter out transient network blips, short enough to surface
 * a genuine outage within ~1 minute.
 *
 * Exactly one capture per failure run: the counter increments on each
 * non-ok response or thrown fetch error, fires exactly once when it
 * equals THRESHOLD, and resets to zero on the next successful response.
 */
const FAILURE_THRESHOLD = 5;

export function useQuotesPoll() {
  const refreshSeconds = useSetting("refreshSeconds");
  const ingest = useQuotes((s) => s.ingest);

  useEffect(() => {
    let cancelled = false;
    let consecutiveFailures = 0;
    async function tick() {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) {
          consecutiveFailures += 1;
          if (consecutiveFailures === FAILURE_THRESHOLD) {
            Sentry.captureMessage(
              `useQuotesPoll: ${FAILURE_THRESHOLD} consecutive fetch failures (status ${res.status})`,
              { level: "warning", tags: { layer: "client-poll" } },
            );
          }
          return;
        }
        consecutiveFailures = 0;
        const { quotes } = await res.json();
        if (!cancelled) ingest(quotes);
      } catch (e) {
        consecutiveFailures += 1;
        if (consecutiveFailures === FAILURE_THRESHOLD) {
          Sentry.captureException(e, {
            tags: { layer: "client-poll" },
          });
        }
        // transient otherwise; next tick retries
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
