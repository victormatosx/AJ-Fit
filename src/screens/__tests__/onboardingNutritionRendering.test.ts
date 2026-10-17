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
        expect(html).toContain(`data-nutrition-control="${step}"`);
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
    expect(renderStep(first).html).toContain('data-nutrition-control="progressionPace"');
    expect(renderStep(next).html).toContain('data-nutrition-control="targetWeightKg"');
    expect(renderStep(first).html).toContain('data-nutrition-control="progressionPace"');
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
