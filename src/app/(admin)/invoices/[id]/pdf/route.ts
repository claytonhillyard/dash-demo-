import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { isDemoMode } from "@/lib/demo/mode";
import { getInvoiceById } from "@/db/invoices";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
import { buildInvoicePdfModel } from "@/lib/invoices/pdfModel";
import { renderInvoicePdf } from "@/lib/invoices/pdfRender";
import { sanitizePdfFilename } from "@/lib/invoices/pdfFilename";

export const dynamic = "force-dynamic";

// Matches the real seeded orgs row for id=1 ("AIYA Designs" —
// drizzle/0004_wild_justin_hammer.sql, test/helpers/shared-db.ts, and the
// app's own branding in src/app/layout.tsx / TopBar.tsx). Spares the orgs
// read in demo mode, mirroring getInvoiceById's own seed-data short-circuit
// (ensureDbReady still runs above, as it does on every admin page).
const DEMO_ORG_NAME = "AIYA Designs";

/**
 * GET /invoices/[id]/pdf — session-guarded, org-scoped PDF download. Demo
 * mode is deliberately allowed (spec §5.3): the download is pure computation
 * over already-public seed data, no different from any other demo page.
 * Any invoice status renders — the model supplies a DRAFT/VOID banner for
 * non-issued invoices; sending (as opposed to downloading) is the
 * issued-only act, enforced separately by sendInvoice.
 *
 * Auth resolves via `getCurrentOrgId()` (demo short-circuit built in) inside
 * a try/catch so an expired/missing session becomes a 401 instead of an
 * unhandled throw — deliberately checked BEFORE touching the db, so the
 * unauthenticated path never needs a live connection.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  // Upper bound matches the int4 id column — without it a crafted
  // /invoices/99999999999/pdf overflows in the db layer and 500s.
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    return new NextResponse(null, { status: 404 });
  }

  let orgId: number;
  try {
    orgId = await getCurrentOrgId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await ensureDbReady();
  const invoice = await getInvoiceById(db, orgId, id);
  if (!invoice) {
    return new NextResponse(null, { status: 404 });
  }

  const orgName = isDemoMode() ? DEMO_ORG_NAME : await resolveOrgLabel(db, orgId);
  const model = buildInvoicePdfModel(invoice, orgName, new Date());
  const bytes = await renderInvoicePdf(model);
  const filename = sanitizePdfFilename(invoice.invoiceNumber);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
