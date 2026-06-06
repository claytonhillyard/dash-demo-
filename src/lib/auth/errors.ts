/** Thrown by server actions to signal an authorization failure. Caught by
 *  the action wrapper (`runWithUser` / `run`) and translated to the uniform
 *  wire response { ok: false, error: "Forbidden" } with zero DB writes.
 *
 *  Promoted from src/lib/deals/actions.ts (slice 4) when slice 4c added a
 *  second consumer (src/lib/circles/actions.ts). Both layers import the
 *  same class; the wire-level uniformity is preserved.
 *
 *  See: docs/superpowers/specs/2026-06-05-aiya-circle-onboarding-slice-4c-design.md §11.2
 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
