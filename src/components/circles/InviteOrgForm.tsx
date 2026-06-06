"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/circles/actions";

export function InviteOrgForm({
  circleId,
  inviteAction,
}: {
  circleId: number;
  inviteAction: (raw: unknown) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    setOk(false);
    const norm = slug.toLowerCase().trim();
    startTransition(async () => {
      const res = await inviteAction({ circleId, toOrgSlug: norm });
      if (res.ok) {
        setOk(true);
        setSlug("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2 text-sm">
      <input
        aria-label={`invite-slug-${circleId}`}
        className="flex-1 bg-bg p-2"
        placeholder="org-slug"
        maxLength={64}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <button type="submit" disabled={pending || slug.length === 0}
        className="rounded bg-gold/80 px-3 py-2 text-black disabled:opacity-50">
        Invite
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
      {ok && <span className="text-xs text-ok">Invited.</span>}
    </form>
  );
}
