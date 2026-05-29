import Link from "next/link";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { getAllDeals, type DealFilters } from "@/lib/deals/queries";
import { getCirclesForOrg } from "@/lib/circles/queries";
import { DEAL_KINDS, DEAL_CATEGORIES, DEAL_STATUSES, type DealKind, type DealCategory, type DealStatus } from "@/lib/deals/constants";
import { DealList } from "@/components/deals/DealList";
import { PostDealForm } from "@/components/deals/PostDealForm";
import { DemoNotice } from "@/components/deals/DemoNotice";
import { postDeal, markDealFilled, withdrawDeal } from "@/lib/deals/actions";

export const dynamic = "force-dynamic";

function pickFilter<T extends readonly string[]>(
  raw: string | string[] | undefined,
  allowed: T,
): T[number] | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters: DealFilters = {
    status: pickFilter(params.status, DEAL_STATUSES) as DealStatus | undefined,
    kind: pickFilter(params.kind, DEAL_KINDS) as DealKind | undefined,
    category: pickFilter(params.category, DEAL_CATEGORIES) as DealCategory | undefined,
  };

  const db = await ensureDbReady();
  const orgId = await getCurrentOrgId();
  const [rows, myCircles] = await Promise.all([
    getAllDeals(db, orgId, filters),
    getCirclesForOrg(db, orgId),
  ]);
  const circleOptions = myCircles.map((c) => ({ id: c.id, name: c.name }));

  return (
    <main className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl tracking-widest text-gold">Deal Room</h1>
        <Link href="/" className="text-sm text-text/50 hover:text-text">Back to dashboard</Link>
      </header>

      <DemoNotice />

      {/* Filter chips */}
      <nav className="mb-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest" aria-label="Deal filters">
        <FilterLink label="All" href="/deals" active={!filters.status && !filters.kind && !filters.category} />
        {DEAL_STATUSES.map((s) => (
          <FilterLink key={s} label={s} href={`/deals?status=${s}`} active={filters.status === s} />
        ))}
        {DEAL_KINDS.map((k) => (
          <FilterLink key={k} label={k} href={`/deals?kind=${k}`} active={filters.kind === k} />
        ))}
        {DEAL_CATEGORIES.map((c) => (
          <FilterLink key={c} label={c} href={`/deals?category=${c}`} active={filters.category === c} />
        ))}
      </nav>

      <PostDealForm postAction={postDeal} circles={circleOptions} />

      <DealList deals={rows} markFilledAction={markDealFilled} withdrawAction={withdrawDeal} />
    </main>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 transition-colors ${
        active
          ? "border-gold/40 bg-gold/10 text-gold"
          : "border-border text-text/60 hover:border-gold/40 hover:text-gold"
      }`}
    >
      {label}
    </Link>
  );
}
