/**
 * Tenancy seam. AIYA is the only org today, so the "current org" is a constant.
 * When the multi-tenant slice lands, `currentOrgId()` becomes the single place
 * that resolves the org from the session — every query/action already calls it.
 */
export const AIYA_ORG_ID = 1;

export function currentOrgId(): number {
  return AIYA_ORG_ID;
}
