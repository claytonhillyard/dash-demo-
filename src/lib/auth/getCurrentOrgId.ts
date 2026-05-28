import { isDemoMode } from "@/lib/demo/mode";
import { requireSession } from "./requireSession";

/** AIYA's seeded id. Fixed across deploys; the only legitimate use of a literal org id
 *  outside the login route is the demo seam. */
export const DEMO_ORG_ID = 1;

/**
 * Single source of truth for "which org is the caller acting on". Async because
 * it reads cookies + verifies the JWT. Throws "Unauthorized" if no valid session.
 * In demo mode short-circuits to AIYA's seeded id — same constant the seed uses.
 *
 * NOT wrapped in React.cache — per request profile guidance, the cookie read +
 * jose verify is cheap (~sub-ms) and a cache wrap adds an indirection that
 * makes test mocking fiddly. Revisit if a real perf trace shows hot-path
 * regressions.
 */
export async function getCurrentOrgId(): Promise<number> {
  if (isDemoMode()) return DEMO_ORG_ID;
  const session = await requireSession();
  return session.orgId;
}
