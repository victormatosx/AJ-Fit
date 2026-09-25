import type { MuscleId } from '../types/exercise';

/** Persisted questionnaire ids. These stay identical to the former card UI. */
export const MUSCLE_FOCUS_IDS = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
] as const;

export type MuscleFocusId = (typeof MUSCLE_FOCUS_IDS)[number];

/** Connects every selectable anatomical region to the existing persisted
 * priority group. Multiple regions intentionally resolve to one group: for
 * example, touching biceps, triceps, or forearms still saves `arms`. */
export const MUSCLE_FOCUS_TO_MAP_MUSCLES = {
  chest: ['chest'],
  back: ['lats', 'upper_back', 'traps', 'lower_back'],
  shoulders: ['front_deltoid', 'side_deltoid', 'rear_deltoid'],
  arms: ['biceps', 'triceps', 'forearms'],
  glutes: ['glutes'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  calves: ['calves'],
} as const satisfies Record<MuscleFocusId, readonly MuscleId[]>;

const MAP_MUSCLE_TO_FOCUS = new Map<MuscleId, MuscleFocusId>(
  MUSCLE_FOCUS_IDS.flatMap((focus) =>
    MUSCLE_FOCUS_TO_MAP_MUSCLES[focus].map((muscle) => [muscle, focus] as const),
  ),
);

/** UI groups mirror the former muscle-focus cards, except that the former
 * `arms` card is exposed through its three independently touchable regions.
 * Those three still persist as the legacy `arms` value. */
export const MUSCLE_FOCUS_VISUAL_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
] as const;

export type MuscleFocusVisualGroup = (typeof MUSCLE_FOCUS_VISUAL_GROUPS)[number];

export const MUSCLE_FOCUS_VISUAL_GROUP_TO_MAP_MUSCLES = {
  chest: ['chest'],
  back: ['lats', 'upper_back', 'traps', 'lower_back'],
  shoulders: ['front_deltoid', 'side_deltoid', 'rear_deltoid'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearms'],
  glutes: ['glutes'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  calves: ['calves'],
} as const satisfies Record<MuscleFocusVisualGroup, readonly MuscleId[]>;

export type MuscleFocusMapMuscle =
  (typeof MUSCLE_FOCUS_VISUAL_GROUP_TO_MAP_MUSCLES)[MuscleFocusVisualGroup][number];

const VISUAL_GROUP_TO_FOCUS: Record<MuscleFocusVisualGroup, MuscleFocusId> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  glutes: 'glutes',
  quads: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
};

const MAP_MUSCLE_TO_VISUAL_GROUP = new Map<MuscleId, MuscleFocusVisualGroup>(
  MUSCLE_FOCUS_VISUAL_GROUPS.flatMap((group) =>
    MUSCLE_FOCUS_VISUAL_GROUP_TO_MAP_MUSCLES[group].map((muscle) => [muscle, group] as const),
  ),
);

export const SELECTABLE_MUSCLE_FOCUS_MAP_MUSCLES: readonly MuscleFocusMapMuscle[] = [
  ...new Set(MUSCLE_FOCUS_VISUAL_GROUPS.flatMap(
    (group) => MUSCLE_FOCUS_VISUAL_GROUP_TO_MAP_MUSCLES[group],
  )),
];

export function muscleFocusForMapMuscle(muscle: MuscleId): MuscleFocusId | null {
  return MAP_MUSCLE_TO_FOCUS.get(muscle) ?? null;
}

export function visualGroupForMapMuscle(muscle: MuscleId): MuscleFocusVisualGroup | null {
  return MAP_MUSCLE_TO_VISUAL_GROUP.get(muscle) ?? null;
}

export function mapMusclesForVisualGroups(
  groups: readonly MuscleFocusVisualGroup[],
): MuscleId[] {
  return [...new Set(groups.flatMap(
    (group) => MUSCLE_FOCUS_VISUAL_GROUP_TO_MAP_MUSCLES[group],
  ))];
}

/** Converts selected UI groups to the unchanged persisted priority ids. */
export function muscleFocusValuesForVisualGroups(
  groups: readonly MuscleFocusVisualGroup[],
): MuscleFocusId[] {
  return [...new Set(groups.map((group) => VISUAL_GROUP_TO_FOCUS[group]))];
}

const FOCUS_TO_VISUAL_GROUP: Record<Exclude<MuscleFocusId, 'arms'>, MuscleFocusVisualGroup> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  glutes: 'glutes',
  quads: 'quads',
  hamstrings: 'hamstrings',
  calves: 'calves',
};

/** Reconstructs a visual selection from previously persisted priority
 * values, e.g. when resuming a draft that already answered this step.
 * `arms` collapses to a single representative region (`biceps`) since the
 * persisted contract never retained which of biceps/triceps/forearms the
 * user actually touched. */
export function visualGroupsForMuscleFocusValues(
  values: readonly string[],
): MuscleFocusVisualGroup[] {
  const groups = values
    .filter((value): value is MuscleFocusId => (MUSCLE_FOCUS_IDS as readonly string[]).includes(value))
    .map((value) => (value === 'arms' ? 'biceps' : FOCUS_TO_VISUAL_GROUP[value]));
  return [...new Set(groups)];
}

export function toggleMuscleFocusVisualGroup(
  currentGroups: readonly MuscleFocusVisualGroup[],
  muscle: MuscleId,
  maxSelections: number,
): MuscleFocusVisualGroup[] {
  const current = currentGroups.filter((group) => MUSCLE_FOCUS_VISUAL_GROUPS.includes(group));
  const group = visualGroupForMapMuscle(muscle);
  if (!group) return [...current];
  if (current.includes(group)) return current.filter((value) => value !== group);
  if (current.length >= maxSelections) return [...current];
  return [...current, group];
}
