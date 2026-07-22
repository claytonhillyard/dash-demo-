import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { collectInvestorKpis } from "@/lib/investor/collect";
import { generateInvestorNarrative } from "@/lib/investor/narrative";
import { buildInvestorReportModel, renderInvestorReportPdf } from "@/lib/investor/reportPdf";

export const dynamic = "force-dynamic";

/** "YYYY-MM" for the UTC year/month of `now` — same month-window convention
 *  as `utcMonthWindow` in src/lib/investor/collect.ts, reimplemented locally
 *  (two lines) rather than imported: that helper returns a start/next-start
 *  pair for a SQL range, not a plain label, and isn't exported. Kept as a
 *  private, non-exported function — Next 15 route files may export ONLY
 *  HTTP-method handlers + config consts (slice-28 lesson; see
 *  src/lib/invoices/pdfFilename.ts's docblock for the same rule applied to
 *  the invoices PDF route). No sanitizer is needed here (contrast
 *  sanitizePdfFilename): every character is self-generated ASCII
 *  (digits and hyphens only), never derived from user/DB input. */
function investorUpdateFilename(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `investor-update-${year}-${month}.pdf`;
}

/**
 * GET /company/investor-update/pdf — session-guarded, org-scoped investor
 * update PDF download. Mirrors src/app/(admin)/invoices/[id]/pdf/route.ts's
 * structure: auth resolved via `getCurrentOrgId()` (demo short-circuit
 * built in) inside a try/catch so an expired/missing session becomes a 401
 * instead of an unhandled throw, checked BEFORE touching the db so the
 * unauthenticated path never needs a live connection. No route params (no
 * [id]) — this is a single, always-current-org report, not a per-record one.
 *
 * Narrative failure (spec §4/§6 — rate-limited, budget-exceeded, provider
 * unavailable, or an unexpected error) maps to a 503 JSON `{ error }` body
 * instead of a broken or partial PDF: a failed download is honest, a PDF
 * missing its narrative section is not. `generateInvestorNarrative` never
 * throws (see its own docblock), so this is the only non-200 outcome past
 * the auth check.
 */
export async function GET(): Promise<Response> {
  let orgId: number;
  try {
    orgId = await getCurrentOrgId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDbReady();
  // Captured once and threaded through both calls below (spec §6) so the
  // KPI period label, the narrative's period reference, and the filename's
  // year-month can never disagree with each other over an instant that
  // happens to straddle a month boundary.
  const now = new Date();
  const kpis = await collectInvestorKpis(db, orgId, now);
  const narrative = await generateInvestorNarrative(kpis, orgId);

  if (!narrative.ok) {
    return NextResponse.json({ error: narrative.error }, { status: 503 });
  }

  const model = buildInvestorReportModel(kpis, narrative.paragraphs, narrative.simulated, now);
  const bytes = await renderInvestorReportPdf(model);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${investorUpdateFilename(now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
