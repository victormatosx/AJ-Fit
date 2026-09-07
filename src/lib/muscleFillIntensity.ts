import type { MuscleId } from '../types/exercise';

export type MuscleFillIntensity = 'primary' | 'secondary' | 'inactive';

/** Pure — kept out of `BodyMuscleMap.tsx` so it's unit-testable without a React Native render environment. */
export function resolveMuscleIntensity(
  muscle: MuscleId,
  primarySet: ReadonlySet<MuscleId>,
  secondarySet: ReadonlySet<MuscleId>,
): MuscleFillIntensity {
  if (primarySet.has(muscle)) return 'primary';
  if (secondarySet.has(muscle)) return 'secondary';
  return 'inactive';
}
