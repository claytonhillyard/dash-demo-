"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormStatus } from "@/components/company/FormStatus";
import { unwatchEntity } from "@/lib/watchlists/actions";
import type { ActivityEntityType } from "@/lib/activity/types";

/**
 * Per-row unwatch control for the /watchlists table. Deliberately not
 * WatchToggle: the page already knows every row is watched (it only lists
 * watches), so there's no unwatched state to render — just a button + inline
 * error, same useTransition/router.refresh conventions as WatchToggle and
 * CustomerForm.
 */
export function UnwatchButton({
  entityType,
  entityId,
}: {
  entityType: ActivityEntityType;
  entityId: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await unwatchEntity({ entityType, entityId });
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded border border-border px-2 py-1 text-[11px] uppercase tracking-wider text-text/70 hover:text-text disabled:opacity-50"
      >
        {pending ? "Unwatching…" : "Unwatch"}
      </button>
      <FormStatus error={error} />
    </div>
  );
}
