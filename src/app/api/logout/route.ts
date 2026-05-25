import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Clears the session cookie. The client then navigates to /login. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ccc_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
