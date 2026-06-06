"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { CircleRow } from "@/lib/circles/queries";

interface MemberRow {
  circle: CircleRow;
  isOwner: boolean;
  members: { orgId: number; name: string; slug: string; createdAt: Date }[];
}

export function MemberCirclesSection({
  rows,
  leaveAction,
}: {
  rows: MemberRow[];
  leaveAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function leave(circleId: number): void {
    setError(null);
    startTransition(async () => {
      const res = await leaveAction({ circleId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Circles you belong to</h2>
      <div className="space-y-3">
        {rows.map(({ circle, members }) => (
          <div key={circle.id} className="surface-card rounded-xl p-4 text-sm" data-testid={`member-circle-${circle.id}`}>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-text/90">{circle.name}</div>
              <button
                type="button"
                disabled={pending}
                onClick={() => leave(circle.id)}
                className="text-[11px] text-bad/80 hover:text-bad disabled:opacity-50"
                data-testid={`leave-${circle.id}`}
              >
                Leave
              </button>
            </div>
            <ul className="space-y-1 text-[12px]">
              {members.map((m) => (
                <li key={m.orgId} className="flex items-center gap-2">
                  <span className="flex-1 text-text/80">{m.name}</span>
                  <span className="text-[10px] text-text/40">{m.slug}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
