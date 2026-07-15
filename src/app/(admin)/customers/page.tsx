import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getCustomers } from "@/db/customers";
import { getCustomerActivityStats } from "@/db/activityEvents";
import { computeHealthScore } from "@/lib/customers/healthScore";
import { CustomersTable } from "@/components/customers/CustomersTable";
import { captureHealthSnapshots, type ScoredCustomerHealth } from "@/lib/sentinel/capture";

export const dynamic = "force-dynamic";

function pickQuery(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0]?.trim() || undefined;
  const v = raw?.trim();
  return v ? v : undefined;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = pickQuery(params.q);

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();

  // Single `now` for the whole render — the health score's recency decay and
  // the aggregate reader's 30-day window must agree on "now" (slice 36).
  const now = new Date();
  const [customers, stats] = await Promise.all([
    getCustomers(db, orgId, { search: q }),
    getCustomerActivityStats(db, orgId, now),
  ]);
  // Keep the FULL computeHealthScore result (components included) per
  // customer — the table only needs {score, band}, but the Sentinel capture
  // call below (slice 38) needs `components` too, and capture never
  // recomputes a score itself (spec §4/§8). Scoring this once and reusing it
  // for both the table rows and the capture input keeps the two from ever
  // silently disagreeing.
  const scored = customers.map((c) => {
    const s = stats.get(c.id);
    const health = computeHealthScore(
      {
        lastActivityAt: s?.lastActivityAt ?? null,
        eventsLast30d: s?.eventsLast30d ?? 0,
        distinctVerbs30d: s?.distinctVerbs30d ?? 0,
        customerCreatedAt: c.createdAt,
      },
      now,
    );
    return { customer: c, health };
  });

  const rows = scored.map(({ customer, health }) => ({
    ...customer,
    health: { score: health.score, band: health.band },
  }));

  // Piggybacks on this render (spec §4): self-guards demo/build/empty
  // internally and never throws, so it's safe to call unconditionally on
  // every render, including in demo mode and during the Next.js build phase.
  const scoredForCapture: ScoredCustomerHealth[] = scored.map(({ customer, health }) => ({
    customerId: customer.id,
    name: customer.name,
    score: health.score,
    band: health.band,
    components: health.components,
  }));
  await captureHealthSnapshots(db, orgId, scoredForCapture, now);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">
          Customers
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/customers/new"
            className="rounded bg-gold px-3 py-1.5 text-xs uppercase tracking-wider text-black"
          >
            New customer
          </Link>
          <Link
            href="/"
            className="text-sm text-text/50 hover:text-text"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <CustomersTable customers={rows} searchQuery={q} />
    </main>
  );
}
