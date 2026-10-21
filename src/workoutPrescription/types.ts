import type { Quiz,ScheduleMode,Weekday } from '../state/AppState';
import type { CatalogExercise } from './exerciseCatalog';
import type { MusclePriorityDecisionV127 } from './musclePriorityV127';

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
}

export const PRESCRIPTION_VERSIONS = {
  templateLibrary: '2.0.0',
  selectionEngine: '2.0.0',
  safetyRules: '1.0.0',
  modifierRules: '2.0.0',
  compositionEngine: '2.1.0',
} as const satisfies PrescriptionVersions;

export const PRESCRIPTION_VERSIONS_V127 = {
  templateLibrary: '1.27.0',
  selectionEngine: '3.0.0',
  safetyRules: '1.0.0',
  modifierRules: '3.0.0',
  compositionEngine: '3.0.0',
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
  | 'MEDICAL_RESTRICTION_UNREPRESENTABLE';

export interface SafetyDecision {
  status: SafetyStatus;
  reasons: SafetyReasonCode[];
  requiredModifierIds: string[];
  protectedConstraints: string[];
}

export interface SelectionDecision {
  templateId: TemplateId;
  requestedDays: number;
  prescribedStructuredDays: number;
  population: Population;
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  reasons: string[];
}

export type WorkoutDayState = 'TRAINING' | 'ACTIVE_RECOVERY' | 'REST';

export interface WorkoutAvailability {
  days: number;
  weekdays: Weekday[];
}

export interface WorkoutWeekdayPrescription {
  weekday: Weekday;
  state: WorkoutDayState;
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
  cycleRange?: { min: number; max: number };
  distance?: string;
  intensity?: string;
  notes?: string;
  source_name_v1_1?: string;
  source_name_v1_2?: string;
}

export interface CanonicalCardioFinisher {
  mode: string;
  exercise_options?: string[];
  duration?: string;
  intensity?: string;
  required: boolean;
  safety_gated?: boolean;
  notes?: string;
}

export interface CanonicalSession {
  name: string;
  type: string;
  notes?: string;
  exercises: CanonicalExercise[];
  display_name?: string;
  technique_guideline?: string;
  effort_guideline?: string;
  rest_guideline?: string;
  progression_guideline?: string;
  cardio_finisher?: CanonicalCardioFinisher;
}

export interface CanonicalTemplate {
  id: TemplateId;
  profile: {
    sex: 'male' | 'female' | 'any';
    environment: TemplateEnvironment;
    primary_goal: GoalFamily | 'pregnancy_fitness' | 'postpartum_return' | 'frailty_function' | 'beginner_adaptation';
    days_per_week: number;
    special_population?: Exclude<Population, 'conventional'>;
    experience_level?: 'beginner';
  };
  split: string;
  rationale: string;
  sessions: CanonicalSession[];
  assumptions?: unknown;
  safety?: unknown;
  weekly_schedule?: unknown;
  experience_modifiers?: unknown;
}

export interface FinalWorkoutExercise {
  exerciseId: string;
  sourceExerciseId: string;
  sets?: number;
  reps?: string;
  duration?: string;
  cycles?: number;
  cycleRange?: { min: number; max: number };
  distance?: string;
  intensity?: string;
  notes?: string;
  restSeconds?: number;
}

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
  displayName?: string;
  techniqueGuideline?: string;
  effortGuideline?: string;
  restGuideline?: string;
  progressionGuideline?: string;
  cardioFinisher?: FinalCardioFinisher;
}

export interface ExerciseSubstitutionTrace {
  sessionIndex: number;
  fromExerciseId: string;
  toExerciseId: string;
  reasonCode: 'EQUIPMENT_UNAVAILABLE';
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
  | 'PRIORITY_SET_SKIPPED_SAFETY';

export interface CompositionDecision {
  reasonCode: CompositionReasonCode;
  sessionIndex: number;
  priority?: string;
  exerciseId?: string;
  baseExerciseCount?: number;
  targetExerciseCount?: number;
  beforeSets?: number;
  afterSets?: number;
}

export interface PrescriptionTrace {
  selectionReasons: string[];
  safety: SafetyDecision;
  appliedModifiers: string[];
  unresolvedModifiers: string[];
  conflicts: ConflictResolution[];
  substitutions: ExerciseSubstitutionTrace[];
  musclePriorityDecisions?: MusclePriorityDecisionV127[];
  compositionDecisions: CompositionDecision[];
  validationCodes: string[];
}

export interface PrescriptionGenerationContext {
  adaptationWeek?: number;
  template?: CanonicalTemplate;
  exerciseCatalog?: readonly CatalogExercise[];
}

export interface FinalWorkoutPlan {
  planId: string;
  templateId: TemplateId;
  requestedDays: number;
  prescribedStructuredDays: number;
  prescribedTrainingFrequency?: number;
  scheduleMode?: ScheduleMode;
  availability?: WorkoutAvailability;
  weeklySchedule?: WorkoutWeekdayPrescription[];
  population: Population;
  environment: TemplateEnvironment;
  goalFamily: GoalFamily;
  split: string;
  adaptationStage?: 1 | 2 | 3;
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
