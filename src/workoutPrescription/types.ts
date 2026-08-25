import type { Quiz } from '../state/AppState';

export type TemplateId = `T${string}`;
export type TemplateEnvironment = 'gym' | 'home';
export type GoalFamily = 'hypertrophy_body_composition' | 'strength' | 'conditioning';
export type Population = 'conventional' | 'pregnancy' | 'postpartum' | 'frailty';
export type SafetyStatus = 'CLEAR' | 'ADAPTED' | 'REQUIRES_CLEARANCE' | 'BLOCKED';

export const PRESCRIPTION_VERSIONS = {
  templateLibrary: '1.3.0',
  selectionEngine: '1.0.0',
  safetyRules: '1.0.0',
  modifierRules: '1.0.0',
  compositionEngine: '1.0.0',
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
  safety?: unknown;
}

export interface FinalWorkoutExercise {
  exerciseId: string;
  sourceExerciseId: string;
  sets?: number;
  reps?: string;
  duration?: string;
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

export interface PrescriptionTrace {
  selectionReasons: string[];
  safety: SafetyDecision;
  appliedModifiers: string[];
  unresolvedModifiers: string[];
  conflicts: ConflictResolution[];
  substitutions: ExerciseSubstitutionTrace[];
  validationCodes: string[];
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
