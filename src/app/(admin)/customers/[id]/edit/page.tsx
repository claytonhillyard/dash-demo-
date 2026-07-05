import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { requireSession } from "@/lib/auth/requireSession";
import { isDemoMode } from "@/lib/demo/mode";
import { getCustomerById } from "@/db/customers";
import { getEntityActivity, getCustomerActivityStats } from "@/db/activityEvents";
import { computeHealthScore, type HealthBand } from "@/lib/customers/healthScore";
import { buildHealthInsightPrompt } from "@/lib/customers/healthInsight";
import { generateAiText } from "@/lib/ai/generateAiText";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { ActivityList } from "@/components/activity/ActivityList";
import { HealthBadge } from "@/components/customers/HealthBadge";
import { WatchToggle } from "@/components/watchlists/WatchToggle";
import { updateCustomer, deleteCustomer } from "@/lib/customers/actions";
import { getWatchForEntity } from "@/lib/watchlists/queries";

// DEMO_WATCHLISTS (src/lib/demo/seed.ts) seeds its two watches under the
// actor "owner@aiya.demo" — the same literal used by every other demo actor
// field (activity events, etc). getWatchForEntity's demo branch filters on
// this exact string, so demo mode must pass it verbatim rather than a
// session-derived value (there's no session to read in demo mode anyway).
const DEMO_ACTOR = "owner@aiya.demo";

export const dynamic = "force-dynamic";

// Band → bar-fill color. Mirrors HealthBadge's BAND_DOT map (kept local
// here rather than exported from HealthBadge — this page is the only
// consumer of the component-bar visualization).
const BAND_BAR: Record<HealthBand, string> = {
  healthy: "bg-emerald-400",
  watch: "bg-amber-300",
  at_risk: "bg-rose-400",
};
const BAND_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
};

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  // Owner-only fetch: null fires notFound() for both "doesn't exist" and
  // "exists in another org". By design — caller can't distinguish.
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const customer = await getCustomerById(db, orgId, id);
  if (!customer) notFound();

  // Same demo short-circuit shape as getCurrentOrgId: demo mode never reads
  // cookies (there's no session to read), so it skips straight to the seed's
  // fixed actor. Live mode re-derives the actor from the session the same
  // way every server action does.
  const actor = isDemoMode() ? DEMO_ACTOR : (await requireSession()).user;
  const watch = await getWatchForEntity(db, orgId, actor, "customer", id);

  const now = new Date();
  const activity = await getEntityActivity(db, orgId, "customer", id, { limit: 20 });

  // One org-wide grouped query, then pick this customer's row — acceptable
  // per spec §5.3 (a per-id variant is premature; the list page already
  // pays this same query cost per render).
  const stats = await getCustomerActivityStats(db, orgId, now);
  const s = stats.get(id);
  const health = computeHealthScore(
    {
      lastActivityAt: s?.lastActivityAt ?? null,
      eventsLast30d: s?.eventsLast30d ?? 0,
      distinctVerbs30d: s?.distinctVerbs30d ?? 0,
      customerCreatedAt: customer.createdAt,
    },
    now,
  );

  // AI insight is garnish: a failed call renders nothing, never an error
  // state. PII discipline: buildHealthInsightPrompt's input type has no
  // email/phone/address/notes fields — see src/lib/customers/healthInsight.ts.
  const insight = await generateAiText({
    feature: "health-score",
    tier: "fast",
    user: `org:${orgId}`,
    prompt: buildHealthInsightPrompt(
      {
        name: customer.name,
        score: health.score,
        band: health.band,
        components: health.components,
        eventsLast30d: s?.eventsLast30d ?? 0,
        lastActivityAt: s?.lastActivityAt ?? null,
      },
      now,
    ),
    maxOutputTokens: 160,
  });
  const insightText = insight.ok ? insight.text : null;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Edit customer
        </h1>
        <Link
          href="/customers"
          className="text-sm text-text/50 hover:text-text"
        >
          Back to customers
        </Link>
      </header>
      <CustomerForm
        mode="edit"
        initial={customer}
        action={updateCustomer}
        deleteAction={deleteCustomer}
      />
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Watch</h2>
        <WatchToggle
          entityType="customer"
          entityId={id}
          initial={{
            watching: watch !== null,
            notifyEmail: watch?.notifyEmail ?? null,
          }}
        />
      </section>
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Health</h2>
        <div className="rounded border border-zinc-700 bg-zinc-900/40 p-3">
          <div className="mb-2 flex items-center gap-3">
            <HealthBadge score={health.score} band={health.band} />
            <span className="text-xs uppercase tracking-wider text-zinc-400">
              {BAND_LABEL[health.band]}
            </span>
          </div>
          <div className="space-y-1.5">
            <HealthBar
              label="Recency"
              value={health.components.recency}
              max={40}
              band={health.band}
            />
            <HealthBar
              label="Frequency"
              value={health.components.frequency}
              max={35}
              band={health.band}
            />
            <HealthBar
              label="Breadth"
              value={health.components.breadth}
              max={25}
              band={health.band}
            />
          </div>
          {insightText ? (
            <p className="mt-3 text-sm text-zinc-300">{insightText}</p>
          ) : null}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">Activity</h2>
        <ActivityList compact events={activity} />
      </section>
    </main>
  );
}

/** One component-bar row: label + a track/fill pair sized to value/max. */
function HealthBar({
  label,
  value,
  max,
  band,
}: {
  label: string;
  value: number;
  max: number;
  band: HealthBand;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-zinc-400">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <span
          className={`block h-full rounded-full ${BAND_BAR[band]}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
