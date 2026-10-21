import { EXERCISES_SEED } from '../data/exercisesSeedData';
import type { MuscleId } from '../types/exercise';

/**
 * Fase 6 — the 10 canonical muscle-priority target groups. English
 * identifiers, coherent with the project's existing `MUSCLE_FOCUS_MAP`
 * naming in `composition.ts` (legacy v2 — not imported here, see
 * `musclePriorityV127.ts`'s file doc), not the Portuguese labels from the
 * task text — those are display copy, not internal ids.
 */
export const MUSCLE_PRIORITY_TARGETS_V127 = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
] as const;

export type MusclePriorityTargetV127 = (typeof MUSCLE_PRIORITY_TARGETS_V127)[number];

const TARGET_SET = new Set<string>(MUSCLE_PRIORITY_TARGETS_V127);

/**
 * Structured catalog metadata only (`Exercise.target.primaryMuscle`) — never
 * inferred from an exercise's name. `core` maps to the catalog's `abs`
 * `MuscleId` explicitly here; the catalog itself is not renamed (`abs`
 * stays `abs` everywhere else in `types/exercise.ts` and
 * `exercisesSeedData.ts`).
 *
 * Primary-muscle-only, deliberately: the legacy v2 muscle-priority
 * candidate search (`composition.ts`'s `priorityCandidates`) has only ever
 * matched `slot.primaryMuscle`, never `secondaryMuscles` — that is the
 * project's one existing precedent for what "this exercise counts toward
 * this priority" means, and Fase 6 §5 says to keep primary-only rather
 * than invent a secondary-inclusive rule the codebase has never used.
 */
const MUSCLE_IDS_BY_TARGET_V127: Record<MusclePriorityTargetV127, readonly MuscleId[]> = {
  chest: ['chest'],
  back: ['lats', 'upper_back', 'traps', 'lower_back'],
  shoulders: ['front_deltoid', 'side_deltoid', 'rear_deltoid'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes'],
  calves: ['calves'],
  core: ['abs'],
};


export function normalizeMusclePriorityInputV127(rawValues: readonly string[]): MusclePriorityTargetV127[] {
  const expanded: string[] = [];
  for (const value of rawValues) {
    if (value === 'arms') { expanded.push('biceps', 'triceps'); continue; }
    expanded.push(value);
  }
  const normalized = expanded.filter((value): value is MusclePriorityTargetV127 => TARGET_SET.has(value));
  return [...new Set(normalized)];
}

const exercisesById = new Map(EXERCISES_SEED.map((exercise) => [exercise.id, exercise]));

/** `null` for any id absent from `EXERCISES_SEED` — i.e. not a resistance exercise (cardio/mobility `CANONICAL_ACTIVITIES`, or unknown). */
export function primaryMuscleForRuntimeIdV127(runtimeId: string): MuscleId | null {
  return exercisesById.get(runtimeId)?.target.primaryMuscle ?? null;
}

export function primaryMuscleMatchesAnyTargetV127(primaryMuscle: MuscleId, targets: readonly MusclePriorityTargetV127[]): boolean {
  return targets.some((target) => MUSCLE_IDS_BY_TARGET_V127[target].includes(primaryMuscle));
}
