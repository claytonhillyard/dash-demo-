"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { CircleRow, InvitationRow } from "@/lib/circles/queries";
import { InviteOrgForm } from "./InviteOrgForm";

interface MemberRow {
  circle: CircleRow;
  isOwner: boolean;
  members: { orgId: number; name: string; slug: string; createdAt: Date }[];
}

export function OwnedCirclesSection({
  owned,
  pendingOutbox,
  memberRows,
  inviteAction,
  removeAction,
}: {
  owned: CircleRow[];
  pendingOutbox: InvitationRow[];
  memberRows: MemberRow[];
  inviteAction: (raw: unknown) => Promise<ActionResult>;
  removeAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (owned.length === 0) return null;

  const outboxByCircle = new Map<number, InvitationRow[]>();
  for (const inv of pendingOutbox) {
    const arr = outboxByCircle.get(inv.circleId) ?? [];
    arr.push(inv);
    outboxByCircle.set(inv.circleId, arr);
  }

  function remove(circleId: number, orgId: number): void {
    setError(null);
    startTransition(async () => {
      const res = await removeAction({ circleId, orgId });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-text/40">Circles you own</h2>
      <div className="space-y-3">
        {owned.map((c) => {
          const row = memberRows.find((m) => m.circle.id === c.id);
          const outbox = outboxByCircle.get(c.id) ?? [];
          return (
            <div key={c.id} className="surface-card rounded-xl p-4 text-sm" data-testid={`owned-circle-${c.id}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="text-text/90">{c.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-text/40">{c.slug}</div>
              </div>
              <div className="mb-2">
                <div className="text-[10px] uppercase tracking-widest text-text/40">Members</div>
                <ul className="mt-1 space-y-1">
                  {(row?.members ?? []).map((m) => (
                    <li key={m.orgId} className="flex items-center gap-2 text-[12px]">
                      <span className="flex-1 text-text/80">{m.name}</span>
                      <span className="text-[10px] text-text/40">{m.slug}</span>
                      {m.orgId !== c.ownerOrgId && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => remove(c.id, m.orgId)}
                          className="text-[11px] text-bad/80 hover:text-bad disabled:opacity-50"
                          data-testid={`remove-${c.id}-${m.orgId}`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {outbox.length > 0 && (
                <div className="mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-text/40">Pending invites (outbox)</div>
                  <ul className="mt-1 space-y-1 text-[12px]">
                    {outbox.map((inv) => (
                      <li key={inv.id} className="flex items-center gap-2">
                        <span className="flex-1 text-text/70">{inv.toOrgSlug}</span>
                        <span className="text-[10px] text-text/40">pending</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <InviteOrgForm circleId={c.id} inviteAction={inviteAction} />
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </section>
  );
}
