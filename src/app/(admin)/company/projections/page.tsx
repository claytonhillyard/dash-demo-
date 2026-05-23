import { getDb } from "@/db/client";
import { projectionAssumptions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { ProjectionsAdmin, type ProjectionInitial } from "@/components/company/ProjectionsAdmin";
import { saveProjection } from "@/lib/company/actions";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const rows = await getDb()
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
  return <ProjectionsAdmin initial={initial} saveAction={saveProjection} />;
}
