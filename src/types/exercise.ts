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
  | 'core_anti_extension'
  | 'core_anti_rotation'
  | 'loaded_carry'
  | 'gait'
  | 'cycling'
  | 'balance'
  | 'mobility'
  | 'breathing';

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
  | 'ez_bar'
  | 'resistance_band'
  | 'chair'
  | 'step'
  | 'stationary_bike'
  | 'slider';

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

export interface ExerciseVideo {
  url: string;
  storagePath: string;
}

/**
 * Vertical and horizontal are independent slots (admin panel — ajfit-admin
 * — attaches/replaces/removes each individually). Both optional, and the
 * whole `videos` map is optional: every one of the 79 seeded documents
 * predates this field and has neither.
 */
export interface ExerciseExecution {
  videos?: {
    vertical?: ExerciseVideo;
    horizontal?: ExerciseVideo;
  };
  thumbnailUrl?: string;
}

export interface ExerciseSubstitution {
  group?: string;
  similarExerciseIds: string[];
  /** Explicit cross-primary-muscle variants approved only for limitation resolution. */
  limitationVariantIds?: string[];
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

export const LIMITATION_REGION_IDS = [
  'knee', 'hip', 'back', 'shoulder', 'elbow', 'wrist', 'ankle_foot',
] as const;

export type LimitationRegionId = (typeof LIMITATION_REGION_IDS)[number];
export type PersistedLimitationStatus = 'compatible' | 'adapt' | 'avoid' | 'not_applicable';
export type LimitationReviewBasis = 'product_policy' | 'professional_review';

export type ExerciseLimitationRule =
  | { status: 'compatible' | 'not_applicable' }
  | { status: 'adapt'; adaptation: { kind: 'exercise_variant'; exerciseId: string } }
  | {
      status: 'avoid';
      substituteExerciseIds: string[];
      candidateStatus: 'ready' | 'missing_exercise_candidate';
    };

interface ExerciseLimitationProfileCore {
  schemaVersion: 1;
  protocolVersion: 'musculoskeletal-v1';
  reviewStatus: 'approved';
  regions: Record<LimitationRegionId, ExerciseLimitationRule>;
}

export type ExerciseLimitationProfile<TTimestamp = unknown> = ExerciseLimitationProfileCore & (
  | { reviewBasis: 'product_policy'; reviewedAt?: never; reviewedBy?: never }
  | { reviewBasis: 'professional_review'; reviewedAt: TTimestamp; reviewedBy: string }
);

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
  limitationProfile?: ExerciseLimitationProfile<TTimestamp>;
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
  'core_anti_rotation', 'loaded_carry', 'gait', 'cycling',
  'balance', 'mobility', 'breathing',
];

export const MECHANICS: Mechanic[] = ['compound', 'isolation'];

export const LATERALITIES: Laterality[] = ['bilateral', 'unilateral', 'alternating'];

export const EQUIPMENT_IDS: EquipmentId[] = [
  'bodyweight', 'barbell', 'dumbbell', 'cable', 'machine',
  'smith_machine', 'hack_machine', 'leg_press', 'bench',
  'roman_chair', 'mini_band', 'ez_bar',
  'resistance_band', 'chair', 'step', 'stationary_bike', 'slider',
];

export const BODY_POSITIONS: BodyPosition[] = [
  'standing', 'seated', 'lying', 'kneeling', 'hanging',
];

export const EXERCISE_DIFFICULTIES: ExerciseDifficulty[] = [
  'beginner', 'intermediate', 'advanced',
];

export const EXERCISE_STATUSES: ExerciseStatus[] = ['active', 'inactive', 'draft'];
