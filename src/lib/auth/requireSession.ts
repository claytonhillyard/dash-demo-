import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "./session";

/** Re-assert the slice-0 session inside a Server Action. Throws "Unauthorized" if absent/invalid.
 *  Returns the full payload (user + orgId) — multi-tenant slice 3. */
export async function requireSession(): Promise<SessionPayload> {
  const token = (await cookies()).get("ccc_session")?.value;
  const session = token ? await verifySession(token, process.env.SESSION_SECRET!) : null;
  if (!session) throw new Error("Unauthorized");
  return session;
}
