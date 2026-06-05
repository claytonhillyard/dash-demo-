"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { formatSessionDuration } from "@/lib/website/format";
import type { WebsiteSnapshotRow } from "@/db/website";
import type { ActionResult } from "@/lib/website/actions";

const NUM = new Intl.NumberFormat("en-US");

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

// TODO(slice-5 review): edit-inline is deliberately deferred per spec §6.2.
// The updateWebsiteSnapshot action + schema ship (covered by tests) but no
// Edit button is wired in this slice. Add a per-row Edit affordance in a
// follow-up.
export function WebsiteAdmin({
  rows, createAction, updateAction, deleteAction,
}: {
  rows: WebsiteSnapshotRow[];
  createAction: (raw: unknown) => Promise<ActionResult>;
  updateAction: (raw: unknown) => Promise<ActionResult>;
  deleteAction: (id: number) => Promise<ActionResult>;
}) {
  // updateAction is accepted for API symmetry — see TODO above for edit-inline deferral.
  void updateAction;
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(todayYmd());
  const [visitors, setVisitors] = useState("");
  const [uniqueVisitors, setUniqueVisitors] = useState("");
  const [pageViews, setPageViews] = useState("");
  const [avgSession, setAvgSession] = useState("");
  const [bounceRate, setBounceRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOk(false); setDuplicate(false);
    setPending(true);
    const raw = {
      weekStart,
      visitors: Math.round(Number(visitors || 0)),
      uniqueVisitors: Math.round(Number(uniqueVisitors || 0)),
      pageViews: Math.round(Number(pageViews || 0)),
      avgSessionDurationSeconds: Math.round(Number(avgSession || 0)),
      bounceRatePercent: Math.round(Number(bounceRate || 0)),
    };
    const res = await createAction(raw);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if ("duplicate" in res && res.duplicate) {
      setDuplicate(true);
      return;
    }
    // Plain success: reset form to defaults.
    setOk(true);
    setWeekStart(todayYmd());
    setVisitors(""); setUniqueVisitors(""); setPageViews("");
    setAvgSession(""); setBounceRate("");
    router.refresh();
  }

  async function onDelete(id: number) {
    const res = await deleteAction(id);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      <form onSubmit={submit} className="surface-card mb-4 grid grid-cols-2 gap-2 rounded-xl p-4 text-sm md:grid-cols-3">
        <label className="flex flex-col">
          Week start
          <input
            aria-label="week start"
            type="date"
            className="bg-bg p-2"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Visitors
          <input
            aria-label="visitors"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={visitors}
            onChange={(e) => setVisitors(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Unique visitors
          <input
            aria-label="unique visitors"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={uniqueVisitors}
            onChange={(e) => setUniqueVisitors(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Page views
          <input
            aria-label="page views"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={pageViews}
            onChange={(e) => setPageViews(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          Avg session (seconds)
          <input
            aria-label="avg session"
            type="number"
            min={0}
            className="bg-bg p-2"
            value={avgSession}
            onChange={(e) => setAvgSession(e.target.value)}
          />
          <span className="text-[10px] text-text/40">e.g. 180 = 3:00, 240 = 4:00</span>
        </label>
        <label className="flex flex-col">
          Bounce rate (%)
          <input
            aria-label="bounce rate"
            type="number"
            min={0}
            max={100}
            className="bg-bg p-2"
            value={bounceRate}
            onChange={(e) => setBounceRate(e.target.value)}
          />
        </label>
        <div className="col-span-2 flex items-center justify-between md:col-span-3">
          <button type="submit" disabled={pending} className="rounded bg-gold p-2 text-black disabled:opacity-50">
            Add snapshot
          </button>
          <FormStatus error={error} ok={ok} duplicate={duplicate} />
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="surface-card rounded-xl p-6 text-center text-sm text-text/40">
          No snapshots yet — add your first week above.
        </div>
      ) : (
        <table className="w-full text-sm" data-testid="website-admin-table">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text/50">
              <th className="p-2">Week</th>
              <th className="p-2">Visitors</th>
              <th className="p-2">Unique</th>
              <th className="p-2">Page Views</th>
              <th className="p-2">Avg Session</th>
              <th className="p-2">Bounce</th>
              <th className="p-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/40">
                <td className="p-2 font-mono">{r.weekStart}</td>
                <td className="p-2 font-mono">{NUM.format(r.visitors)}</td>
                <td className="p-2 font-mono">{NUM.format(r.uniqueVisitors)}</td>
                <td className="p-2 font-mono">{NUM.format(r.pageViews)}</td>
                <td className="p-2 font-mono">{formatSessionDuration(r.avgSessionDurationSeconds)}</td>
                <td className="p-2 font-mono">{r.bounceRatePercent}%</td>
                <td className="p-2 text-right">
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    className="text-bad hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
