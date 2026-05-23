import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/lib/auth/session";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/quotes", "/company/:path*"] };
