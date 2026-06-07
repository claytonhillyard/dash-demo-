"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";
import type { InvitationRow } from "@/lib/circles/queries";

function timeAgoShort(d: Date): string {
  const ms = Date.now() - d.getTime();
  const h = Math.round(ms / (60 * 60 * 1000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PendingInvitesInbox({
  invitations,
  acceptAction,
  declineAction,
}: {
  invitations: InvitationRow[];
  acceptAction: (raw: unknown) => Promise<ActionResult>;
  declineAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<Record<number, string>>({});
  const [pending, startTransition] = useTransition();

  function respond(token: string, id: number, action: (raw: unknown) => Promise<ActionResult>): void {
    setError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const res = await action({ token });
      if (res.ok) {
        router.refresh();
      } else {
        setError((prev) => ({ ...prev, [id]: res.error }));
      }
    });
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] uppercase tracking-widest text-gold/80">Pending invitations</h2>
      <ul className="surface-card divide-y divide-text/10 rounded-xl text-sm">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 p-3" data-testid={`invite-row-${inv.id}`}>
            <div className="flex-1">
              <div className="text-text/90">{inv.circleName}</div>
              <div className="text-[11px] text-text/40">
                from {inv.fromOrgName} · {timeAgoShort(inv.createdAt)}
              </div>
              {error[inv.id] && <div className="mt-1 text-xs text-bad">{error[inv.id]}</div>}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => respond(inv.token, inv.id, acceptAction)}
              className="rounded bg-gold px-3 py-1.5 text-black disabled:opacity-50"
              data-testid={`accept-${inv.id}`}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => respond(inv.token, inv.id, declineAction)}
              className="rounded border border-text/20 px-3 py-1.5 text-text/70 hover:text-text disabled:opacity-50"
              data-testid={`decline-${inv.id}`}
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
