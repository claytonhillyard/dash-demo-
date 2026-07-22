import { ensureDbReady } from "@/db/client";
import { projectionAssumptions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ProjectionsAdmin, type ProjectionInitial } from "@/components/company/ProjectionsAdmin";
import { saveProjection } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const rows = await (await ensureDbReady())
    .select({
      baseYear: projectionAssumptions.baseYear,
      baseRevenueCents: projectionAssumptions.baseRevenueCents,
      cagrPct: projectionAssumptions.cagrPct,
      perYearOverrides: projectionAssumptions.perYearOverrides,
    })
    .from(projectionAssumptions)
    .orderBy(desc(projectionAssumptions.updatedAt))
    .limit(1);

  const initial = (rows[0] ?? null) as ProjectionInitial | null;
  return (
    <div className="space-y-4">
      <ProjectionsAdmin initial={initial} saveAction={saveProjection} />

      {/* Slice 41: investor-update PDF download. Plain server-rendered
          card — same rounded-lg/bg-surface/p-4 section shell
          ProjectionsAdmin itself uses, stacked via the space-y-4 wrapper
          above (src/app/(admin)/company/revenue/page.tsx's convention for
          multiple cards on one page). The link is a plain <a>, not
          next/link: the route streams PDF bytes, it isn't a client-side
          navigation (same rationale as the invoices edit page's own
          "Download PDF" link) — styled like the invoices list page's
          header-action links (/invoices "Import history"), not that plain
          text-link, per spec §6. */}
      <section className="rounded-lg bg-surface p-4">
        <h2 className="font-display text-gold mb-3 tracking-wider">Investor update</h2>
        <p className="text-text/70 mb-3 text-sm">
          One-page PDF: key metrics plus an AI-written narrative.
        </p>
        <a
          href="/company/investor-update/pdf"
          className="rounded border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-text/70 hover:text-gold"
        >
          Download PDF
        </a>
        <p className="text-text/40 mt-3 text-sm">
          Narrative is AI-generated — simulated without an AI key.
        </p>
      </section>
    </div>
  );
}
