import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const { user, password } = await req.json();
  if (user !== process.env.DASHBOARD_USER || password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const token = await createSession(user, process.env.SESSION_SECRET!);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ccc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
