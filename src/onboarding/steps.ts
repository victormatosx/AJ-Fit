import { PROFILE_STEP_IDS, needsNutritionGoalCategory, type ProfileStepId } from '../nutrition/ui/profileSteps';
import type { NutritionGoal } from '../types/nutrition';

/**
 * Central definition of the onboarding funnel's step order — the single
 * source of truth for "what comes after what". See
 * docs/onboarding_funnel_architecture.md for the full narrative rationale.
 *
 * `App.tsx`/`premiumGate.ts` know nothing about the registered step ids — they only see
 * the single `RootScreenId` value `'onboardingFunnel'`. Everything below is
 * internal to `useOnboardingFunnel`/`OnboardingFunnelScreen`. The registry
 * includes every possible branch; `getStepSequence` removes inapplicable
 * questions for the current answers.
 */

export type OnboardingStepKind =
  | 'presentation'
  | 'question'
  | 'interstitial'
  | 'socialProof'
  | 'processing'
  | 'result'
  | 'healthIntegration'
  | 'auth'
  | 'monetization';

export type OnboardingStepId =
  | `nutrition_${ProfileStepId}`
  | 'presentation'
  | 'name'
  | 'welcome'
  | 'goal'
  | 'level'
  | 'interstitial_evolution'
  | 'sex'
  | 'birthDate'
  | 'height'
  | 'weight'
  | 'interstitial_methodology'
  | 'days'
  | 'duration'
  | 'place'
  | 'equipment'
  | 'interstitial_guidedWorkout'
  | 'limits'
  | 'specialConditions'
  | 'pregnancyWeeks'
  | 'pregnancyCare'
  | 'pregnancyWarningSigns'
  | 'postpartumContext'
  | 'postpartumSigns'
  | 'postpartumReturnClearance'
  | 'functionalSituations'
  | 'lipedemaScreening'
  | 'dizzinessScreening'
  | 'postSurgicalStatus'
  | 'postSurgicalRegion'
  | 'medicalRestrictionDetails'
  | 'muscleFocus'
  | 'interstitial_ajFitProgress'
  | 'socialProof'
  | 'commitment'
  | 'analyzing'
  | 'plan'
  | 'healthIntegration'
  | 'auth'
  | 'paywall';

export interface OnboardingStepDef {
  id: OnboardingStepId;
  kind: OnboardingStepKind;
  /** Only 'question' steps count toward the progress bar's denominator. */
  countsTowardProgress: boolean;
  /** Whether this step's answer is written into the local anonymous draft. */
  persistsToDraft: boolean;
  /** Eligible for direct __DEV__ jump. Auth/paywall are never jumpable — see DevFunnelNavigator. */
  devJumpable: boolean;
}

/** Máximo de grupos musculares prioritários selecionáveis na etapa `muscleFocus` — ver docs/onboarding_funnel_architecture.md. */
export const MAX_MUSCLE_FOCUS = 2;

export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { id: 'presentation', kind: 'presentation', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'name', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'welcome', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'sex', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'birthDate', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'height', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'weight', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'goal', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'level', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_evolution', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'interstitial_methodology', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'days', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'duration', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'place', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'equipment', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_guidedWorkout', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'muscleFocus', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  // Fase 5 — the only health-integration offer in the app; reused nowhere
  // else. Deliberately absent from `FORCED_QUESTIONNAIRE_STEP_IDS` below:
  // that mode is for an ALREADY-authenticated account (repairing missing
  // questionnaire data), so this step — which only ever records a pre-auth
  // intent, never a live connection — would have nothing meaningful to do
  // there; an already-authenticated user who wants to connect already has
  // the Settings screen for that.
  { id: 'healthIntegration', kind: 'healthIntegration', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'specialConditions', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'limits', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'lipedemaScreening', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'dizzinessScreening', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'postSurgicalStatus', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'postSurgicalRegion', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'pregnancyWeeks', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'pregnancyCare', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'pregnancyWarningSigns', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'postpartumContext', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'postpartumSigns', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'postpartumReturnClearance', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'functionalSituations', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'medicalRestrictionDetails', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_ajFitProgress', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  ...PROFILE_STEP_IDS.map((id): OnboardingStepDef => ({ id: `nutrition_${id}`, kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true })),
  { id: 'socialProof', kind: 'socialProof', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'commitment', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'analyzing', kind: 'processing', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'plan', kind: 'result', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'auth', kind: 'auth', countsTowardProgress: false, persistsToDraft: false, devJumpable: false },
  { id: 'paywall', kind: 'monetization', countsTowardProgress: false, persistsToDraft: false, devJumpable: false },
] as const;

/**
 * Etapas percorridas por um usuário JÁ AUTENTICADO sem questionário (ex.:
 * social login que nunca passou pelo funil anônimo). Pula apresentação,
 * nome e boas-vindas (não fazem sentido para quem já tem conta), e
 * compromisso/prova social (redundante pós-conversão). Mantém os
 * interstitials de valor — não coletam dado e reforçam percepção de
 * personalização mesmo pós-cadastro.
 */
export const FORCED_QUESTIONNAIRE_STEP_IDS: readonly OnboardingStepId[] = [
  'sex',
  'birthDate',
  'height',
  'weight',
  'goal',
  'level',
  'interstitial_evolution',
  'interstitial_methodology',
  'days',
  'duration',
  'place',
  'equipment',
  'interstitial_guidedWorkout',
  'muscleFocus',
  'specialConditions',
  'limits',
  'lipedemaScreening',
  'dizzinessScreening',
  'postSurgicalStatus',
  'postSurgicalRegion',
  'pregnancyWeeks',
  'pregnancyCare',
  'pregnancyWarningSigns',
  'postpartumContext',
  'postpartumSigns',
  'postpartumReturnClearance',
  'functionalSituations',
  'medicalRestrictionDetails',
  'interstitial_ajFitProgress',
  'analyzing',
  'plan',
];

const STEP_INDEX_BY_ID: Record<OnboardingStepId, number> = ONBOARDING_STEPS.reduce(
  (acc, step, i) => {
    acc[step.id] = i;
    return acc;
  },
  {} as Record<OnboardingStepId, number>,
);

export function getStepDef(id: OnboardingStepId): OnboardingStepDef {
  const step = ONBOARDING_STEPS[STEP_INDEX_BY_ID[id]];
  if (!step) throw new Error(`Unknown onboarding step id: ${id}`);
  return step;
}

export function getStepIndex(id: OnboardingStepId): number {
  return STEP_INDEX_BY_ID[id];
}

export type OnboardingFlowAnswers = {
  goal?: NutritionGoal | null;
  sex?: string | null;
  place?: string | null;
  limits?: string[];
  specialConditions?: string[];
  days?: number | null;
};

function isApplicableStep(id: OnboardingStepId, answers?: OnboardingFlowAnswers): boolean {
  if (!answers) return true;
  if (id === 'nutrition_nutritionGoalCategory') return !answers.goal || needsNutritionGoalCategory(answers.goal);
  // v1.27 never considers a home equipment inventory in any generation step
  // (selection, composition, or cycle evolution) — Home templates are
  // already authored to be executable at home by definition (see
  // homeEquipmentAuditV127.test.ts). Asking this question would only
  // collect data no engine version acts on going forward, and produce a
  // phantom `equipment_required` validation failure since it's never
  // answered — so it's never shown, regardless of `place`. The `equipment`
  // step/field stay registered (schema, draft persistence, legacy v2
  // `equipmentContextFor`, manual exercise-substitution) for backward
  // compatibility with already-persisted answers; only its visibility here
  // changed.
  if (id === 'equipment') return false;
  if (id === 'limits') {
    return !!answers?.specialConditions?.includes('musculoskeletal_limitation');
  }
  if (id === 'lipedemaScreening') return !!answers?.specialConditions?.includes('lipedema');
  if (id === 'dizzinessScreening') return !!answers?.specialConditions?.includes('dizziness_or_vertigo');
  if (id === 'postSurgicalStatus' || id === 'postSurgicalRegion') {
    return !!answers?.specialConditions?.includes('post_surgical');
  }
  if (id.startsWith('pregnancy')) return !!answers?.specialConditions?.includes('pregnancy');
  if (id.startsWith('postpartum')) return !!answers?.specialConditions?.includes('postpartum');
  if (id === 'functionalSituations') return !!answers?.specialConditions?.includes('functional_limitation');
  if (id === 'medicalRestrictionDetails') return !!answers?.specialConditions?.includes('medical_restriction');
  return true;
}

export function getStepSequence(
  mode: 'anonymous' | 'forcedQuestionnaire',
  answers?: OnboardingFlowAnswers,
): readonly OnboardingStepId[] {
  const base = mode === 'forcedQuestionnaire'
    ? FORCED_QUESTIONNAIRE_STEP_IDS
    : ONBOARDING_STEPS.map((s) => s.id);
  return base.filter((id) => isApplicableStep(id, answers));
}

export function getNextStepId(
  current: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
  answers?: OnboardingFlowAnswers,
): OnboardingStepId | null {
  const seq = getStepSequence(mode, answers);
  const i = seq.indexOf(current);
  if (i === -1 || i === seq.length - 1) return null;
  return seq[i + 1];
}

/**
 * Kinds with no back button of their own — pure auto-advancing transitions
 * (interstitials, social proof, the analyzing screen). Never a valid back
 * target: landing on one would show a screen the user can't interact with
 * or navigate further back from.
 */
const NON_BACK_TARGET_KINDS: readonly OnboardingStepKind[] = ['interstitial', 'socialProof', 'processing'];

export function getPreviousStepId(
  current: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
  answers?: OnboardingFlowAnswers,
): OnboardingStepId | null {
  const seq = getStepSequence(mode, answers);
  let i = seq.indexOf(current) - 1;
  while (i >= 0 && NON_BACK_TARGET_KINDS.includes(getStepDef(seq[i]).kind)) {
    i -= 1;
  }
  return i >= 0 ? seq[i] : null;
}

const QUESTION_STEP_IDS: readonly OnboardingStepId[] = ONBOARDING_STEPS.filter(
  (s) => s.countsTowardProgress,
).map((s) => s.id);

/**
 * How many slides the `presentation` step shows before the questionnaire
 * starts. Authority for both the slides themselves (`OnboardingScreen`) and
 * the offset the question numbering continues from.
 */
export const PRESENTATION_SLIDE_COUNT = 3 as const;

/**
 * Progresso para `SegBar`: só perguntas contam. Interstitials/prova
 * social/presentation/processing/result "congelam" a barra no valor da
 * última pergunta respondida em vez de fazê-la andar e parar.
 */
export function computeOnboardingProgress(
  currentStepId: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
  answers?: OnboardingFlowAnswers,
): { current: number; total: number } {
  const seq = getStepSequence(mode, answers);
  // `presentation` renders PRESENTATION_SLIDE_COUNT slides of its own,
  // numbered from 01. The questionnaire continues that count instead of
  // restarting, so the user sees one unbroken sequence. `forcedQuestionnaire`
  // skips the presentation entirely and therefore takes no offset.
  const slideOffset = seq.includes('presentation') ? PRESENTATION_SLIDE_COUNT : 0;
  const total = seq.filter((id) => QUESTION_STEP_IDS.includes(id)).length + slideOffset;
  const idx = seq.indexOf(currentStepId);
  let current = 0;
  for (let i = 0; i <= idx; i++) {
    if (QUESTION_STEP_IDS.includes(seq[i])) current++;
  }
  // The presentation itself stays at 0: it numbers its own slides internally,
  // and the bar has nothing to hold at yet.
  if (current > 0) current += slideOffset;
  return { current, total };
}

export function isStepDevJumpable(id: OnboardingStepId): boolean {
  return getStepDef(id).devJumpable;
}
