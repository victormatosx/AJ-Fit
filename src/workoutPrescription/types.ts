import type { Quiz } from '../state/AppState';
import type { LimitationCatalogExercise, LimitationDecisionTrace } from './limitationResolver';

export type TemplateId = `T${string}`;
export type TemplateEnvironment = 'gym' | 'home';
export type GoalFamily = 'hypertrophy_body_composition' | 'strength' | 'conditioning';
export type Population = 'conventional' | 'pregnancy' | 'postpartum' | 'frailty';
export type SafetyStatus = 'CLEAR' | 'ADAPTED' | 'REQUIRES_CLEARANCE' | 'BLOCKED';

export const PRESCRIPTION_VERSIONS = {
  templateLibrary: '1.3.0',
  selectionEngine: '1.0.0',
  safetyRules: '1.0.0',
  modifierRules: '2.0.0',
  compositionEngine: '2.0.0',
  limitationResolver: '1.0.0',
} as const;

export type PrescriptionVersions = typeof PRESCRIPTION_VERSIONS;

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
  | 'MUSCULOSKELETAL_MILD'
  | 'MUSCULOSKELETAL_ADAPTATION_REQUIRED'
  | 'MUSCULOSKELETAL_PROFESSIONAL_RESTRICTION'
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

export interface CanonicalSession {
  name: string;
  type: string;
  notes?: string;
  exercises: CanonicalExercise[];
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
}

export interface FinalWorkoutSession {
  name: string;
  type: string;
  notes?: string;
  exercises: FinalWorkoutExercise[];
}

export interface ExerciseSubstitutionTrace {
  sessionIndex: number;
  fromExerciseId: string;
  toExerciseId: string;
  reasonCode: 'EQUIPMENT_UNAVAILABLE';
}

export type CompositionReasonCode =
  | 'BEGINNER_SESSION_REDUCED'
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
  limitationResolverVersion: 1;
  limitationDecisions: LimitationDecisionTrace[];
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
}

export interface FinalWorkoutPlan {
  planId: string;
  templateId: TemplateId;
  requestedDays: number;
  prescribedStructuredDays: number;
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
  | 'MISSING_EXERCISE';

export type PrescriptionResult =
  | { status: 'SUCCESS'; plan: FinalWorkoutPlan }
  | {
      status: PrescriptionFailureCode;
      reasonCodes: string[];
      safety?: SafetyDecision;
      trace?: Partial<PrescriptionTrace>;
    };

export type QuestionnaireAnswers = Quiz;
