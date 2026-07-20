import { NextResponse } from "next/server";
import { ensureDbReady } from "@/db/client";
import { getCurrentOrgId } from "@/lib/auth/getCurrentOrgId";
import { isDemoMode } from "@/lib/demo/mode";
import { getInvoiceById } from "@/db/invoices";
import { resolveOrgLabel } from "@/lib/auth/orgLabel";
import { buildInvoicePdfModel } from "@/lib/invoices/pdfModel";
import { renderInvoicePdf } from "@/lib/invoices/pdfRender";

export const dynamic = "force-dynamic";

// Matches the real seeded orgs row for id=1 ("AIYA Designs" —
// drizzle/0004_wild_justin_hammer.sql, test/helpers/shared-db.ts, and the
// app's own branding in src/app/layout.tsx / TopBar.tsx). Demo mode never
// touches the orgs table for this header — same "serve seed data without a
// DB round-trip" discipline as getInvoiceById's own demo short-circuit —
// keeping the whole demo download path DB-independent.
const DEMO_ORG_NAME = "AIYA Designs";

/**
 * Strips characters that would break or inject into the Content-Disposition
 * header's quoted filename: a `"` would end the quoted string early, and a
 * bare CR/LF could inject a new header line. Exported so the edge case (an
 * invoice number containing a quote or embedded newline) is unit-testable
 * without a full request/response round trip.
 */
export function sanitizePdfFilename(invoiceNumber: string): string {
  return invoiceNumber.replace(/["\r\n]/g, "");
}

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
  if (!Number.isInteger(id) || id <= 0) {
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
