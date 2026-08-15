/**
 * Central definition of the onboarding funnel's step order — the single
 * source of truth for "what comes after what". See
 * docs/onboarding_funnel_architecture.md for the full narrative rationale.
 *
 * `App.tsx`/`premiumGate.ts` know nothing about these 26 ids — they only see
 * the single `RootScreenId` value `'onboardingFunnel'`. Everything below is
 * internal to `useOnboardingFunnel`/`OnboardingFunnelScreen`.
 */

export type OnboardingStepKind =
  | 'presentation'
  | 'question'
  | 'interstitial'
  | 'socialProof'
  | 'processing'
  | 'result'
  | 'auth'
  | 'monetization';

export type OnboardingStepId =
  | 'presentation'
  | 'name'
  | 'welcome'
  | 'motivation'
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
  | 'muscleFocus'
  | 'interstitial_ajFitProgress'
  | 'socialProof'
  | 'commitment'
  | 'analyzing'
  | 'plan'
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
  { id: 'motivation', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'goal', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'level', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_evolution', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'sex', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'birthDate', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'height', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'weight', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_methodology', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'days', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'duration', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'place', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'equipment', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_guidedWorkout', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
  { id: 'limits', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'muscleFocus', kind: 'question', countsTowardProgress: true, persistsToDraft: true, devJumpable: true },
  { id: 'interstitial_ajFitProgress', kind: 'interstitial', countsTowardProgress: false, persistsToDraft: false, devJumpable: true },
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
 * nome, boas-vindas e motivação (não fazem sentido para quem já tem conta),
 * e compromisso/prova social (redundante pós-conversão). Mantém os
 * interstitials de valor — não coletam dado e reforçam percepção de
 * personalização mesmo pós-cadastro.
 */
export const FORCED_QUESTIONNAIRE_STEP_IDS: readonly OnboardingStepId[] = [
  'goal',
  'level',
  'interstitial_evolution',
  'sex',
  'birthDate',
  'height',
  'weight',
  'interstitial_methodology',
  'days',
  'duration',
  'place',
  'equipment',
  'interstitial_guidedWorkout',
  'limits',
  'muscleFocus',
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

export function getStepSequence(mode: 'anonymous' | 'forcedQuestionnaire'): readonly OnboardingStepId[] {
  return mode === 'forcedQuestionnaire'
    ? FORCED_QUESTIONNAIRE_STEP_IDS
    : ONBOARDING_STEPS.map((s) => s.id);
}

export function getNextStepId(
  current: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
): OnboardingStepId | null {
  const seq = getStepSequence(mode);
  const i = seq.indexOf(current);
  if (i === -1 || i === seq.length - 1) return null;
  return seq[i + 1];
}

export function getPreviousStepId(
  current: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
): OnboardingStepId | null {
  const seq = getStepSequence(mode);
  const i = seq.indexOf(current);
  if (i <= 0) return null;
  return seq[i - 1];
}

const QUESTION_STEP_IDS: readonly OnboardingStepId[] = ONBOARDING_STEPS.filter(
  (s) => s.countsTowardProgress,
).map((s) => s.id);

/**
 * Progresso para `SegBar`: só perguntas contam. Interstitials/prova
 * social/presentation/processing/result "congelam" a barra no valor da
 * última pergunta respondida em vez de fazê-la andar e parar.
 */
export function computeOnboardingProgress(
  currentStepId: OnboardingStepId,
  mode: 'anonymous' | 'forcedQuestionnaire',
): { current: number; total: number } {
  const seq = getStepSequence(mode);
  const total = seq.filter((id) => QUESTION_STEP_IDS.includes(id)).length;
  const idx = seq.indexOf(currentStepId);
  let current = 0;
  for (let i = 0; i <= idx; i++) {
    if (QUESTION_STEP_IDS.includes(seq[i])) current++;
  }
  // Non-question steps (interstitials etc.) show the count of the last
  // answered question rather than 0, so the bar holds its position.
  if (!QUESTION_STEP_IDS.includes(currentStepId) && current === 0) {
    // Before the first question (presentation/name is itself a question, so
    // this only applies to 'presentation').
    current = 0;
  }
  return { current, total };
}

export function isStepDevJumpable(id: OnboardingStepId): boolean {
  return getStepDef(id).devJumpable;
}
