import type { MuscleId } from '../types/exercise';

/**
 * Centralized AJ Fit `MuscleId` -> `@musclemap/assets` region mapping —
 * validated visually in the body-muscle-map spike (see
 * `THIRD_PARTY_NOTICES.md` for asset provenance). The only place these
 * `@musclemap/assets` group/part-id strings should appear — `BodyMuscleMap`
 * and any other consumer must go through `getMusclePartIds`/
 * `muscleForPartId`, never hardcode a group key themselves.
 *
 * All 18 `MuscleId`s map 1:1 to a distinct region here (no merges, unlike
 * the runner-up spike candidate) — `MUSCLE_ID_TO_GROUP` being typed as
 * `Record<MuscleId, ...>` means adding a new `MuscleId` to
 * `types/exercise.ts` without adding its entry here is a TypeScript error,
 * not a silent gap.
 */
export type MuscleMapGroupKey =
  | 'CHEST'
  | 'LATS'
  | 'RHOMBOIDS'
  | 'TRAPEZIUS'
  | 'BACK_LOWER'
  | 'SHOULDERS_FRONT'
  | 'SHOULDERS_SIDE'
  | 'SHOULDERS_REAR'
  | 'BICEPS'
  | 'TRICEPS'
  | 'FOREARMS'
  | 'QUADS'
  | 'HAMSTRINGS'
  | 'GLUTES'
  | 'ADDUCTORS'
  | 'ABDUCTORS'
  | 'CALVES'
  | 'CORE';

/** `@musclemap/assets` addressable part ids (`muscle.id` in the vendored diagrams) per group. */
export const MUSCLE_GROUP_PART_IDS: Record<MuscleMapGroupKey, readonly string[]> = {
  CHEST: ['CHEST_LEFT', 'CHEST_RIGHT'],
  LATS: ['LATISSIMUS_LEFT', 'LATISSIMUS_RIGHT'],
  RHOMBOIDS: ['RHOMBOID_LEFT', 'RHOMBOID_RIGHT'],
  TRAPEZIUS: ['TRAPEZIUS', 'TRAPEZIUS_LEFT', 'TRAPEZIUS_RIGHT'],
  BACK_LOWER: ['LOWER_BACK_LEFT', 'LOWER_BACK_RIGHT'],
  SHOULDERS_FRONT: ['SHOULDER_FRONT_LEFT', 'SHOULDER_FRONT_RIGHT'],
  SHOULDERS_SIDE: ['SHOULDER_SIDE_LEFT', 'SHOULDER_SIDE_RIGHT'],
  SHOULDERS_REAR: ['SHOULDER_REAR_LEFT', 'SHOULDER_REAR_RIGHT'],
  BICEPS: ['BICEPS_LEFT', 'BICEPS_RIGHT'],
  TRICEPS: ['TRICEPS_LEFT', 'TRICEPS_RIGHT'],
  FOREARMS: ['FOREARM_LEFT', 'FOREARM_RIGHT'],
  QUADS: ['QUADRICEPS_LEFT', 'QUADRICEPS_RIGHT'],
  HAMSTRINGS: ['HAMSTRINGS_LEFT', 'HAMSTRINGS_RIGHT'],
  GLUTES: ['GLUTEUS_LEFT', 'GLUTEUS_RIGHT'],
  ADDUCTORS: ['ADDUCTOR_LEFT', 'ADDUCTOR_RIGHT'],
  ABDUCTORS: ['ABDUCTOR_LEFT', 'ABDUCTOR_RIGHT'],
  CALVES: ['CALVES_LEFT', 'CALVES_RIGHT'],
  CORE: ['CORE_LEFT', 'CORE_RIGHT'],
};

/** The 18/18 mapping validated in the spike — see `docs` reference in `BodyMuscleMap.tsx`. */
export const MUSCLE_ID_TO_GROUP: Record<MuscleId, MuscleMapGroupKey> = {
  chest: 'CHEST',
  lats: 'LATS',
  upper_back: 'RHOMBOIDS',
  traps: 'TRAPEZIUS',
  lower_back: 'BACK_LOWER',
  front_deltoid: 'SHOULDERS_FRONT',
  side_deltoid: 'SHOULDERS_SIDE',
  rear_deltoid: 'SHOULDERS_REAR',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  forearms: 'FOREARMS',
  quads: 'QUADS',
  hamstrings: 'HAMSTRINGS',
  glutes: 'GLUTES',
  adductors: 'ADDUCTORS',
  abductors: 'ABDUCTORS',
  calves: 'CALVES',
  abs: 'CORE',
};

export function getMusclePartIds(muscle: MuscleId): readonly string[] {
  return MUSCLE_GROUP_PART_IDS[MUSCLE_ID_TO_GROUP[muscle]];
}

/** Reverse lookup (`@musclemap/assets` part id -> `MuscleId`) — built once, used to color each rendered path. */
const PART_ID_TO_MUSCLE: ReadonlyMap<string, MuscleId> = new Map(
  (Object.keys(MUSCLE_ID_TO_GROUP) as MuscleId[]).flatMap((muscle) =>
    getMusclePartIds(muscle).map((partId) => [partId, muscle] as const),
  ),
);

/** `undefined` for a part id outside AJ Fit's 18-muscle taxonomy (e.g. obliques) — renders neutral. */
export function muscleForPartId(partId: string | undefined): MuscleId | undefined {
  return partId ? PART_ID_TO_MUSCLE.get(partId) : undefined;
}
