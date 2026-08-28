import type { Quiz, Weekday } from '../state/AppState';
import type { LimitationCatalogExercise, LimitationDecisionTrace } from './limitationResolver';
import type { LimitationDatasetIdentity } from './limitationDataset';

export type TemplateId = `T${string}`;
export type TemplateEnvironment = 'gym' | 'home';
export type GoalFamily = 'hypertrophy_body_composition' | 'strength' | 'conditioning';
export type Population = 'conventional' | 'pregnancy' | 'postpartum' | 'frailty';
export type SafetyStatus = 'CLEAR' | 'ADAPTED' | 'REQUIRES_CLEARANCE' | 'BLOCKED';

export interface PrescriptionVersions {
  templateLibrary: string;
  selectionEngine: string;
  safetyRules: string;
  modifierRules: string;
  compositionEngine: string;
  limitationResolver: string;
}

export const PRESCRIPTION_VERSIONS = {
  templateLibrary: '2.0.0',
  selectionEngine: '2.0.0',
  safetyRules: '1.0.0',
  modifierRules: '2.0.0',
  compositionEngine: '2.1.0',
  limitationResolver: '1.0.0',
} as const satisfies PrescriptionVersions;

export type SafetyReasonCode =
  | 'PREGNANCY_POPULATION'
  | 'PREGNANCY_RED_FLAG'
  | 'PREGNANCY_RESTRICTION'
  | 'PREGNANCY_COMPLICATION'
  | 'POSTPARTUM_POPULATION'
  | 'POSTPARTUM_SYMPTOMS'
  | 'POSTPARTUM_NOT_CLEARED'
  | 'FUNCTIONAL_CAPACITY_LIMITATION'
  | 'FUNCTIONAL_BALANCE_OR_FALL_RISK'
  | 'POST_SURGICAL_IN_PROGRESS_ADAPTED'
  | 'POST_SURGICAL_RESTRICTION'
  | 'POST_SURGICAL_STATUS_UNSURE'
  | 'DIZZINESS_CONTROLLED'
  | 'DIZZINESS_RELEVANT'
  | 'LIPEDEMA_MILD'
  | 'LIPEDEMA_INTERFERES'
  | 'LIPEDEMA_GUIDANCE_UNREPRESENTABLE'
  | 'MUSCULOSKELETAL_ADAPTATION_REQUIRED'
  | 'MEDICAL_RESTRICTION_UNREPRESENTABLE';

export interface SafetyDecision {
  status: SafetyStatus;
  reasons: SafetyReasonCode[];
  requiredModifierIds: string[];
  protectedConstraints: string[];
}

export interface SelectionDecision {
  templateId: TemplateId;
  /** Questionnaire availability ceiling. Kept as `requestedDays` on legacy snapshots. */
  requestedDays: number;
  /** Number of TRAINING sessions. Recovery sessions never count toward this value. */
  prescribedStructuredDays: number;
  population: Population;
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  reasons: string[];
}

export type WorkoutDayState = 'TRAINING' | 'ACTIVE_RECOVERY' | 'REST';

export interface WorkoutAvailability {
  days: number;
  /** Empty only when a legacy questionnaire did not collect concrete weekdays. */
  weekdays: Weekday[];
}

export interface WorkoutWeekdayPrescription {
  weekday: Weekday;
  state: WorkoutDayState;
  /** Index into `FinalWorkoutPlan.sessions`; absent for REST. */
  sessionIndex?: number;
}

export type ModifierPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';
export type ModifierApplication = 'APPLIED' | 'DECLARATIVE' | 'RULE_DEFINITION_REQUIRED';

export interface ResolvedModifier {
  id: string;
  priority: ModifierPriority;
  application: ModifierApplication;
  reasonCode: string;
  protectedConstraints?: string[];
}

export interface ConflictResolution {
  id: string;
  winnerModifierId: string;
  constrainedModifierId: string;
  reasonCode: string;
}

export interface CanonicalExercise {
  name: string;
  exercise_id: string;
  catalog_status?: string;
  sets?: number;
  reps?: string;
  duration?: string;
  cycles?: number;
  intensity?: string;
  notes?: string;
  source_name_v1_1?: string;
  source_name_v1_2?: string;
}

/**
 * A short, optional cardio block appended after a resistance session's own
 * exercises — never a replacement for them, never itself a `session`. Schema
 * introduced in the v2.0.0 template library (`cardio_finisher`). `required`
 * is catalog-authored intent, not a safety clearance: composition still runs
 * it through the same safety/population gates as everything else before it
 * can survive into a `FinalWorkoutSession` — see `composition.ts`.
 */
export interface CanonicalCardioFinisher {
  mode: string;
  /** Omitted only for `mode: "integrated"`, which marks cardio already in-session. */
  exercise_options?: string[];
  duration?: string;
  intensity?: string;
  required: boolean;
  /** Authoring signal used by special-population finishers. */
  safety_gated?: boolean;
  notes?: string;
}

export interface CanonicalSession {
  name: string;
  type: string;
  notes?: string;
  exercises: CanonicalExercise[];
  /** v2.0.0+. Commercial/presentation name — see `sessionPresentation.ts`. */
  display_name?: string;
  /** v2.0.0+. See `CanonicalCardioFinisher`. */
  cardio_finisher?: CanonicalCardioFinisher;
}

export interface CanonicalTemplate {
  id: TemplateId;
  profile: {
    sex: 'male' | 'female' | 'any';
    environment: TemplateEnvironment;
    primary_goal: GoalFamily | 'pregnancy_fitness' | 'postpartum_return' | 'frailty_function';
    days_per_week: number;
    special_population?: Exclude<Population, 'conventional'>;
  };
  split: string;
  rationale: string;
  sessions: CanonicalSession[];
  assumptions?: unknown;
  safety?: unknown;
  /**
   * v2.0.0+. Documentation-only metadata, deliberately NOT consumed by the
   * runtime calendar. Phase 2 deliberately keeps the typed, deterministic
   * Schedule Engine authoritative instead of promoting localized authoring
   * strings into a contract. Kept loosely typed for tooling only.
   */
  weekly_schedule?: unknown;
  /**
   * v2.0.0+. Declarative authoring guidance (target exercise-count ranges,
   * etc.) that informed how the v2 catalog content itself was written.
   * Documentation-only this phase — NOT read by `personalization.ts`, which
   * implements its own fixed beginner policy (see `beginnerAdjustedSets`).
   */
  experience_modifiers?: unknown;
}

export interface FinalWorkoutExercise {
  exerciseId: string;
  sourceExerciseId: string;
  sets?: number;
  reps?: string;
  duration?: string;
  cycles?: number;
  intensity?: string;
  notes?: string;
  /**
   * Prescribed rest between sets, in seconds — decided once, here, by
   * `restPrescription.ts` at composition time (Phase 2). `0` is a
   * deliberate "no traditional rest" value for movement patterns where it
   * doesn't apply (mobility/balance/breathing/gait/cycling), not a missing
   * value. Absent (`undefined`) ONLY on a snapshot persisted before this
   * field existed — consumers (the Rest Timer) must use
   * `LEGACY_REST_SECONDS_FALLBACK`, never silently treat that as `0`.
   */
  restSeconds?: number;
}

/** Runtime counterpart of `CanonicalCardioFinisher` — camelCase, same fields. */
export interface FinalCardioFinisher {
  mode: string;
  exerciseOptions: string[];
  duration: string;
  intensity: string;
  required: boolean;
  safetyGated?: boolean;
  notes?: string;
}

export interface FinalWorkoutSession {
  name: string;
  type: string;
  notes?: string;
  exercises: FinalWorkoutExercise[];
  /** Preferred over `name` for UI presentation when present — see `sessionPresentation.ts`. */
  displayName?: string;
  /** Absent when the source session has none, or when safety/population gating removed it. */
  cardioFinisher?: FinalCardioFinisher;
}

export interface ExerciseSubstitutionTrace {
  sessionIndex: number;
  fromExerciseId: string;
  toExerciseId: string;
  reasonCode: 'EQUIPMENT_UNAVAILABLE';
}

export type WorkoutExerciseOmissionReason =
  | 'NO_SAFE_SUBSTITUTION'
  | 'NO_ENVIRONMENT_CANDIDATE'
  | 'COLLISION_NO_ALTERNATIVE'
  | 'MULTI_LIMITATION_NO_INTERSECTION';

export interface WorkoutExerciseOmissionTrace {
  event: 'workout_exercise_omitted';
  sessionIndex: number;
  sourceExerciseId: string;
  reason: WorkoutExerciseOmissionReason;
}

export type CompositionReasonCode =
  | 'BEGINNER_VOLUME_REDUCED'
  | 'DURATION_SESSION_REDUCED'
  | 'DURATION_SET_FALLBACK'
  | 'MUSCLE_PRIORITY_PRESERVED'
  | 'MUSCLE_PRIORITY_REORDERED'
  | 'MUSCLE_PRIORITY_SET_ADDED'
  | 'PRIORITY_SET_SKIPPED_BEGINNER'
  | 'PRIORITY_SET_SKIPPED_DURATION'
  | 'PRIORITY_SET_SKIPPED_SAFETY'
  | 'OMIT_UNSAFE_EXERCISE';

export interface CompositionDecision {
  reasonCode: CompositionReasonCode;
  sessionIndex: number;
  priority?: string;
  exerciseId?: string;
  baseExerciseCount?: number;
  targetExerciseCount?: number;
  beforeSets?: number;
  afterSets?: number;
  omissionReason?: WorkoutExerciseOmissionReason;
}

export interface PrescriptionTrace {
  selectionReasons: string[];
  safety: SafetyDecision;
  appliedModifiers: string[];
  unresolvedModifiers: string[];
  conflicts: ConflictResolution[];
  substitutions: ExerciseSubstitutionTrace[];
  limitationResolverVersion: 1;
  limitationDecisions: LimitationDecisionTrace[];
  /** Absent only on plans persisted before contextual limitation omission support. */
  exerciseOmissions?: WorkoutExerciseOmissionTrace[];
  compositionDecisions: CompositionDecision[];
  validationCodes: string[];
}

export interface PrescriptionGenerationContext {
  /** Week 1 is the default for a newly generated beginner plan; 3 means Week 3+. */
  adaptationWeek?: number;
  /** Explicit runtime template. Production supplies this from Firestore. */
  template?: CanonicalTemplate;
  /** One preloaded catalog snapshot; the pure resolver performs no Firestore reads. */
  exerciseCatalog?: readonly LimitationCatalogExercise[];
  /** Exact clinical dataset used by this generation; remote callers must pass the verified Firestore identity. */
  limitationDataset?: LimitationDatasetIdentity;
}

export interface FinalWorkoutPlan {
  planId: string;
  templateId: TemplateId;
  requestedDays: number;
  prescribedStructuredDays: number;
  /** Phase 2 canonical name. `prescribedStructuredDays` remains a backward-compatible alias. */
  prescribedTrainingFrequency?: number;
  /** Phase 2 explicit availability; absent on Phase 1/v1.3 snapshots. */
  availability?: WorkoutAvailability;
  /** Monday-first, reproducible calendar; absent on legacy snapshots. */
  weeklySchedule?: WorkoutWeekdayPrescription[];
  population: Population;
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  split: string;
  adaptationStage?: 1 | 2 | 3;
  limitationDatasetVersion: string;
  limitationDatasetHash: string;
  sessions: FinalWorkoutSession[];
  versions: PrescriptionVersions;
  trace: PrescriptionTrace;
}

export type PrescriptionFailureCode =
  | 'NEEDS_QUESTIONNAIRE_UPDATE'
  | 'REQUIRES_CLEARANCE'
  | 'BLOCKED'
  | 'INVALID_CONFIGURATION'
  | 'MISSING_TEMPLATE'
  | 'MISSING_EXERCISE'
  | 'NO_EXECUTABLE_SESSION';

export type PrescriptionResult =
  | { status: 'SUCCESS'; plan: FinalWorkoutPlan }
  | {
      status: PrescriptionFailureCode;
      reasonCodes: string[];
      safety?: SafetyDecision;
      trace?: Partial<PrescriptionTrace>;
    };

export type QuestionnaireAnswers = Quiz;
