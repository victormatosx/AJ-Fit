import type { Sex } from '../state/AppState';

export type BodyMuscleMapView = 'front' | 'back';
export type BodyMuscleMapPathLayer = 'outline' | 'hit' | 'visual';
export type BodyMuscleMapDiagramKey = `${'male' | 'female'}-${BodyMuscleMapView}`;

type KeyableBodyMapPath = {
  id?: string;
  group?: string;
  side?: string | null;
};

export function bodyMuscleMapDiagramKey(
  sex: Sex,
  view: BodyMuscleMapView,
): BodyMuscleMapDiagramKey {
  return `${sex === 'm' ? 'male' : 'female'}-${view}`;
}

/**
 * React identity is intentionally separate from the anatomical surface id.
 * A surface may contain multiple SVG paths in @musclemap/assets v1.0.1, so
 * the stable array position disambiguates those paths without changing the
 * id consumed by muscleMapRegions, highlighting, or interaction callbacks.
 */
export function bodyMuscleMapPathKey(
  diagramKey: BodyMuscleMapDiagramKey,
  layer: BodyMuscleMapPathLayer,
  path: KeyableBodyMapPath,
  index: number,
): string {
  const anatomicalIdentity = path.id ?? `${path.group ?? 'path'}-${path.side ?? 'center'}`;
  return `${diagramKey}-${layer}-${anatomicalIdentity}-${index}`;
}
