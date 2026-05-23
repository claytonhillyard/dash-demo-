import { cookies } from "next/headers";
import { verifySession } from "./session";

/** Re-assert the slice-0 session inside a Server Action. Throws "Unauthorized" if absent/invalid. */
export async function requireSession(): Promise<{ user: string }> {
  const token = (await cookies()).get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) throw new Error("Unauthorized");
  return session;
}
