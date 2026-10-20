import React from 'react';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionStepScreen } from '../../components/onboarding/QuestionStepScreen';
import { emptyOnboardingNutrition } from '../../onboarding/nutritionDraft';
import { computeOnboardingProgress, getNextStepId, getPreviousStepId, getStepSequence, type OnboardingStepId } from '../../onboarding/steps';
import { profileStepOrder } from '../../nutrition/ui/profileSteps';
import type { NutritionGoal } from '../../types/nutrition';
import { OnboardingFunnelScreen } from '../OnboardingFunnelScreen';

// The app already includes react-dom; keep this Node-only harness independent
// of optional DOM typings and of a native test renderer.
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (element: React.ReactNode) => string;
};
type QuestionProps = React.ComponentProps<typeof QuestionStepScreen>;
const harness = vi.hoisted(() => ({ useFunnel: vi.fn(), question: null as QuestionProps | null }));
vi.mock('../../onboarding/useOnboardingFunnel', () => ({ useOnboardingFunnel: harness.useFunnel }));
// Keep the real funnel's render routing and callbacks; replace native surfaces
// and services so SSR cannot touch a device, persisted draft, Firebase or media.
vi.mock('react-native', () => ({ View: 'div', Text: 'span', Pressable: 'button', KeyboardAvoidingView: 'div',
  Platform: { OS: 'ios' }, Keyboard: { dismiss: vi.fn() }, Alert: { alert: vi.fn() } }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../theme', () => ({ useTheme: () => ({ theme: { colors: { background: '#020010' } } }) }));
vi.mock('../../state/UnitsContext', () => ({ useUnits: () => ({ resolvedUnits: 'metric' }) }));
vi.mock('../../services/nutritionFoods', () => ({ validateCustomFoodInput: vi.fn() }));
vi.mock('../../lib/logger', () => ({ logInfo: vi.fn() }));
vi.mock('../../onboarding/onboardingAnalytics', () => ({ logOnboardingEvent: vi.fn() }));
vi.mock('../../onboarding/onboardingVideoPreload', () => ({ preloadMethodologyVideo: vi.fn(), preloadGuidedWorkoutVideo: vi.fn(),
  releaseMethodologyVideoPlayer: vi.fn(), releaseGuidedWorkoutVideoPlayer: vi.fn() }));
vi.mock('../../components/onboarding/AnimatedStepContainer', () => ({ AnimatedStepContainer: ({ children }: { children: React.ReactNode }) => React.createElement('main', null, children) }));
// The funnel's persistent AJ layer. Rendered as a transparent pass-through
// here for the same reason `AnimatedStepContainer` is: it wraps the step tree
// without participating in step routing, and its real implementation reaches
// for Reanimated and safe-area insets that this Node-only SSR harness has no
// device for. Every assertion below is about WHICH step renders WHICH control
// and with what progress/continue state — none of which this wrapper decides.
vi.mock('../../components/onboarding/AjFunnelStage', () => {
  const inertDirector = () => ({
    reduceMotion: true,
    layout: { width: 0, height: 0, safeTop: 0, safeBottom: 0 },
    direct: vi.fn(), setMood: vi.fn(), setLook: vi.fn(),
    setTalking: vi.fn(), play: vi.fn(), setVisible: vi.fn(),
  });
  return {
    AjFunnelStage: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    useAjFunnelDirector: inertDirector,
    useAjStagePose: inertDirector,
  };
});
vi.mock('../../components/onboarding/QuestionStepScreen', () => ({ QuestionStepScreen: (props: QuestionProps) => {
  harness.question = props;
  return React.createElement('section', { 'data-step': props.question.id },
    React.createElement('h1', null, props.title), props.answerControl,
    React.createElement('button', { disabled: !props.canContinueOverride }, 'Continuar'));
} }));
vi.mock('../nutrition/NutritionProfileScreen', () => ({ NutritionProfileQuestion: ({ step }: { step: string }) => React.createElement('div', { 'data-nutrition-control': step }, step) }));
vi.mock('../../components/onboarding/WeeklySchedulePicker', () => ({ ScheduleModeLink: () => null, WeeklySchedulePicker: () => null }));
vi.mock('../../components/onboarding/MuscleFocusBodyMapPicker', () => ({ MuscleFocusBodyMapPicker: () => null }));
vi.mock('../../components/onboarding/DevFunnelNavigator', () => ({ DevFunnelNavigator: () => null }));
vi.mock('../OnboardingScreen', () => ({ OnboardingScreen: () => null }));
vi.mock('../SocialProofScreen', () => ({ SocialProofScreen: () => React.createElement('div', null, 'social-proof') }));
vi.mock('../AnalyzingScreen', () => ({ AnalyzingScreen: () => null }));
vi.mock('../PlanReadyScreen', () => ({ PlanReadyScreen: () => null }));
vi.mock('../onboarding/NameStepScreen', () => ({ NameStepScreen: () => null }));
vi.mock('../onboarding/HealthIntegrationOnboardingScreen', () => ({ HealthIntegrationOnboardingScreen: () => null }));
vi.mock('../onboarding/WelcomeInterstitialScreen', () => ({ WelcomeInterstitialScreen: () => null }));
vi.mock('../onboarding/EvolutionInterstitialScreen', () => ({ EvolutionInterstitialScreen: () => null }));
vi.mock('../onboarding/MethodologyInterstitialScreen', () => ({ MethodologyInterstitialScreen: () => null }));
vi.mock('../onboarding/GuidedWorkoutInterstitialScreen', () => ({ GuidedWorkoutInterstitialScreen: () => null }));
vi.mock('../onboarding/AjFitProgressInterstitialScreen', () => ({ AjFitProgressInterstitialScreen: () => React.createElement('div', null, 'ajfit-progress') }));

/**
 * Which control draws each nutrition step.
 *
 * The eight steps that map onto a questionnaire `kind` now render through
 * `QuestionStepScreen`'s own controls — the same ruled rows, radio and ruler
 * the training questions use — instead of `NutritionProfileQuestion`'s
 * `SelectableRow`/`SelectableChip`. Those primitives are shared with fourteen
 * nutrition screens outside the funnel, so they stayed put and the funnel
 * moved instead (see `nutritionFunnelQuestions.ts`).
 *
 * The two catalogue searches have no questionnaire `kind` that describes
 * them and still come from `NutritionProfileQuestion`.
 *
 * Pinning the KIND per step is stricter than the marker this replaced: it
 * fails if a step silently changes control, not merely if it loses one.
 */
const NATIVE_CONTROL_KIND: Record<string, string> = {
  nutritionGoalCategory: 'choice-large',
  progressionPace: 'choice-large',
  nonTrainingActivityLevel: 'choice-large',
  varietyPreference: 'choice-large',
  mealSlots: 'multi',
  excludedAllergens: 'multi',
  supplements: 'multi',
  targetWeightKg: 'wheel',
};

function expectStepControl(html: string, step: string, id: string, question: QuestionProps | null) {
  const nativeKind = NATIVE_CONTROL_KIND[step];
  if (!nativeKind) {
    expect(html).toContain(`data-nutrition-control="${step}"`);
    return;
  }
  expect(question?.question.id).toBe(id);
  expect(question?.question.kind).toBe(nativeKind);
  // Rendered by the step screen itself, not handed in as a composed control.
  expect(question?.answerControl).toBeUndefined();
}

function renderStep(id: OnboardingStepId, goal: NutritionGoal = 'lose_fat') {
  const quiz = { goal, weight: 80, muscleFocus: [], specialConditions: [], trainingDays: [] };
  const funnel = { currentStepId: id, hydrated: true, pendingTransfer: false, quiz, name: 'Teste',
    nutrition: emptyOnboardingNutrition(), progress: computeOnboardingProgress(id, 'anonymous', quiz),
    setNutrition: vi.fn(), goNext: vi.fn(), goBack: vi.fn(), canGoBack: true };
  harness.useFunnel.mockReturnValue(funnel);
  harness.question = null;
  const html = renderToStaticMarkup(React.createElement(OnboardingFunnelScreen, {
    mode: 'anonymous', onAuthRequested: vi.fn(), onForcedQuestionnaireDone: vi.fn(),
  }));
  return { html, funnel };
}

beforeEach(() => { vi.stubGlobal('__DEV__', false); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe('onboarding nutrition rendered content', () => {
  for (const goal of ['lose_fat', 'strength'] as const) {
    it(`renders every control and onboarding chrome between progress and social proof for ${goal}`, () => {
      const order = profileStepOrder(goal);
      expect(order).toHaveLength(goal === 'strength' ? 10 : 9);
      expect(renderStep('interstitial_ajFitProgress', goal).html).toContain('ajfit-progress');
      let previous: OnboardingStepId = 'interstitial_ajFitProgress';
      for (const step of order) {
        const id = `nutrition_${step}` as const;
        expect(getNextStepId(previous, 'anonymous', { goal })).toBe(id);
        const { html, funnel } = renderStep(id, goal);
        expect(html).toContain(`data-step="${id}"`);
        expectStepControl(html, step, id, harness.question);
        expect(html).toContain(`profile.questions.${step}.title`);
        expect(html).toContain('Continuar');
        expect(harness.question?.stepNumber).toBe(funnel.progress.current);
        expect(harness.question?.totalSteps).toBe(funnel.progress.total);
        harness.question?.onBack?.();
        expect(funnel.goBack).toHaveBeenCalledOnce();
        previous = id;
      }
      expect(getNextStepId(previous, 'anonymous', { goal })).toBe('socialProof');
      expect(renderStep('socialProof', goal).html).toContain('social-proof');
    });
  }

  it('renders the same persisted step when resuming or navigating back from another nutrition question', () => {
    const first = getNextStepId('interstitial_ajFitProgress', 'anonymous', { goal: 'lose_fat' })!;
    const next = getNextStepId(first, 'anonymous', { goal: 'lose_fat' })!;
    expect(getPreviousStepId(next, 'anonymous', { goal: 'lose_fat' })).toBe(first);
    expectStepControl(renderStep(first).html, 'progressionPace', first, harness.question);
    expectStepControl(renderStep(next).html, 'targetWeightKg', next, harness.question);
    expectStepControl(renderStep(first).html, 'progressionPace', first, harness.question);
  });

  it('preserves required pace validation and advances the optional target-weight question', () => {
    renderStep('nutrition_progressionPace');
    expect(harness.question?.canContinueOverride).toBe(false);
    const { funnel } = renderStep('nutrition_targetWeightKg');
    expect(harness.question?.canContinueOverride).toBe(true);
    harness.question?.onNext();
    expect(funnel.goNext).toHaveBeenCalledOnce();
  });

  it('keeps nutrition out of the workout repair sequence', () => {
    expect(getStepSequence('forcedQuestionnaire', { goal: 'strength' }).some(id => id.startsWith('nutrition_'))).toBe(false);
  });
});
