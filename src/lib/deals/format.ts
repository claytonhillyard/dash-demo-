export interface DealVisibility {
  kind: "private" | "circle";
  /** Present iff kind === "circle". */
  circleName?: string;
}

/**
 * Resolves a deal's visibility to a UI label.
 *
 * Defensive fallback: if `visibilityCircleId` is not in the viewer's
 * `circleNamesById` map, returns { kind: "private" } so the badge silently
 * disappears rather than rendering a circle name the viewer shouldn't know.
 * The widened deals query (slice 4) makes the unknown-id case unreachable
 * in well-formed code; this is belt-and-suspenders against a future bug.
 */
export function formatDealVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): DealVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" };
  return { kind: "circle", circleName: name };
}
