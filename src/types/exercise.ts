/**
 * Shape of `exercises/{exerciseId}` — the official global exercise library
 * (docs/27_biblioteca_de_exercicios.md). Global exercises are administered
 * content: only the seed script (Admin SDK) may write here; the app only
 * ever reads (see `firestore.rules`, match /exercises/{exerciseId}).
 *
 * `id`/`slug` are the same stable, English, name-independent identifier
 * (docs/27 §2) — duplicated on the document body so callers that already
 * hold an `Exercise` don't need the document id separately.
 */

export type MuscleId =
  | 'chest'
  | 'lats'
  | 'upper_back'
  | 'traps'
  | 'lower_back'
  | 'front_deltoid'
  | 'side_deltoid'
  | 'rear_deltoid'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'adductors'
  | 'abductors'
  | 'calves'
  | 'abs';

export type MuscleRegionId =
  | 'upper_chest'
  | 'mid_chest'
  | 'lower_chest'
  | 'upper_lats'
  | 'mid_back'
  | 'upper_traps'
  | 'lower_back'
  | 'front_deltoid'
  | 'side_deltoid'
  | 'rear_deltoid'
  | 'rectus_abdominis';

/**
 * Canonical movement patterns. `scapular_elevation` (shrugs) and
 * `horizontal_adduction` (chest fly / pec deck) were added beyond the
 * reference list in docs/27 §6 because no listed pattern described them
 * without forcing a biomechanically wrong classification (per the seed
 * task's own instruction to prefer a coherent new value over a bad fit).
 */
export type MovementPattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'knee_extension'
  | 'knee_flexion'
  | 'hip_extension'
  | 'hip_abduction'
  | 'hip_adduction'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'shoulder_abduction'
  | 'shoulder_flexion'
  | 'scapular_retraction'
  | 'scapular_elevation'
  | 'horizontal_adduction'
  | 'calf_raise'
  | 'core_flexion'
  | 'core_anti_extension';

export type Mechanic = 'compound' | 'isolation';

export type Laterality = 'bilateral' | 'unilateral' | 'alternating';

export type EquipmentId =
  | 'bodyweight'
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'smith_machine'
  | 'hack_machine'
  | 'leg_press'
  | 'bench'
  | 'roman_chair'
  | 'mini_band'
  | 'ez_bar';

export type BodyPosition = 'standing' | 'seated' | 'lying' | 'kneeling' | 'hanging';

export type ExerciseDifficulty = 'beginner' | 'intermediate' | 'advanced';

export type ExerciseStatus = 'active' | 'inactive' | 'draft';

export interface LocalizedText {
  ptBR: string;
  en: string;
  es: string;
}

export interface LocalizedInstructions {
  ptBR: string[];
  en?: string[];
  es?: string[];
}

export interface ExerciseTarget {
  primaryMuscle: MuscleId;
  primaryRegion?: MuscleRegionId;
  secondaryMuscles: MuscleId[];
}

export interface ExerciseMovement {
  pattern: MovementPattern;
  mechanic: Mechanic;
  laterality: Laterality;
}

export interface ExerciseExecution {
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface ExerciseSubstitution {
  group?: string;
  similarExerciseIds: string[];
}

export interface ExerciseAvailability {
  workoutGeneration: boolean;
  manualSelection: boolean;
  substitution: boolean;
}

export interface ExerciseMetadata<TTimestamp = unknown> {
  version: number;
  createdAt: TTimestamp;
  updatedAt: TTimestamp;
}

export interface Exercise<TTimestamp = unknown> {
  id: string;
  name: LocalizedText;
  slug: string;
  status: ExerciseStatus;
  target: ExerciseTarget;
  movement: ExerciseMovement;
  equipment: EquipmentId[];
  bodyPosition?: BodyPosition;
  execution: ExerciseExecution;
  instructions?: LocalizedInstructions;
  substitution: ExerciseSubstitution;
  difficulty: ExerciseDifficulty;
  availability: ExerciseAvailability;
  tags?: string[];
  metadata: ExerciseMetadata<TTimestamp>;
}

/** Seed input shape: everything in `Exercise` except server-assigned metadata. */
export type ExerciseSeedInput = Omit<Exercise, 'metadata'>;

export const MUSCLE_IDS: MuscleId[] = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back',
  'front_deltoid', 'side_deltoid', 'rear_deltoid',
  'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves', 'abs',
];

export const MUSCLE_REGION_IDS: MuscleRegionId[] = [
  'upper_chest', 'mid_chest', 'lower_chest',
  'upper_lats', 'mid_back', 'upper_traps', 'lower_back',
  'front_deltoid', 'side_deltoid', 'rear_deltoid', 'rectus_abdominis',
];

export const MOVEMENT_PATTERNS: MovementPattern[] = [
  'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
  'squat', 'hinge', 'lunge',
  'knee_extension', 'knee_flexion', 'hip_extension', 'hip_abduction', 'hip_adduction',
  'elbow_flexion', 'elbow_extension',
  'shoulder_abduction', 'shoulder_flexion',
  'scapular_retraction', 'scapular_elevation', 'horizontal_adduction',
  'calf_raise', 'core_flexion', 'core_anti_extension',
];

export const MECHANICS: Mechanic[] = ['compound', 'isolation'];

export const LATERALITIES: Laterality[] = ['bilateral', 'unilateral', 'alternating'];

export const EQUIPMENT_IDS: EquipmentId[] = [
  'bodyweight', 'barbell', 'dumbbell', 'cable', 'machine',
  'smith_machine', 'hack_machine', 'leg_press', 'bench',
  'roman_chair', 'mini_band', 'ez_bar',
];

export const BODY_POSITIONS: BodyPosition[] = [
  'standing', 'seated', 'lying', 'kneeling', 'hanging',
];

export const EXERCISE_DIFFICULTIES: ExerciseDifficulty[] = [
  'beginner', 'intermediate', 'advanced',
];

export const EXERCISE_STATUSES: ExerciseStatus[] = ['active', 'inactive', 'draft'];
