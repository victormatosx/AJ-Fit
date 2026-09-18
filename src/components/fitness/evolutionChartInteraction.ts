export function nearestEvolutionPointIndex(
  locationX: number,
  width: number,
  pointCount: number,
): number | null {
  if (
    !Number.isFinite(locationX)
    || !Number.isFinite(width)
    || width <= 0
    || pointCount <= 0
  ) return null;

  if (pointCount === 1) return 0;
  const progress = Math.min(1, Math.max(0, locationX / width));
  return Math.round(progress * (pointCount - 1));
}

export function adjacentEvolutionPointIndex(
  current: number | null,
  pointCount: number,
  direction: -1 | 1,
): number | null {
  if (pointCount <= 0) return null;
  const startingPoint = current ?? (direction > 0 ? -1 : pointCount);
  return Math.min(pointCount - 1, Math.max(0, startingPoint + direction));
}
