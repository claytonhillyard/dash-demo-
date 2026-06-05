import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifySession } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/demo/mode";

export async function middleware(req: NextRequest) {
  try {
    if (isDemoMode()) return NextResponse.next();
    const token = req.cookies.get("ccc_session")?.value;
    const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  } catch (e) {
    // The `process.env.SESSION_SECRET!` non-null assertion above is exactly
    // the kind of thing that should be captured if it ever fires — silently
    // 500-ing with no telemetry is what this slice exists to fix.
    Sentry.captureException(e, { tags: { layer: "middleware" } });
    throw e; // let Next.js's default error handling continue
  }
}

export const config = {
  matcher: [
    "/", "/api/quotes", "/api/convert", "/api/history", "/api/diamond-history",
    "/inventory", "/diamonds", "/deals", "/website", "/company/:path*",
  ],
};
