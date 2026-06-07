export interface InventoryVisibility {
  kind: "private" | "circle";
  circleName?: string;
}

/** Slice 15 — mirrors slice-4 formatDealVisibility byte-for-byte. The
 *  name-leak guard: unknown circle ids fall back to 'private'. */
export function formatInventoryVisibility(
  visibilityCircleId: number | null,
  circleNamesById: Map<number, string>,
): InventoryVisibility {
  if (visibilityCircleId === null) return { kind: "private" };
  const name = circleNamesById.get(visibilityCircleId);
  if (!name) return { kind: "private" };
  return { kind: "circle", circleName: name };
}
