import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOnboardingFunnel, type OnboardingFunnelMode } from '../onboarding/useOnboardingFunnel';
import { FUNNEL_QUESTIONS } from '../onboarding/questionDefs';
import { getNextStepId } from '../onboarding/steps';
import type { OnboardingAuthContext } from '../onboarding/authContext';
import { logOnboardingEvent } from '../onboarding/onboardingAnalytics';
import {
  preloadMethodologyVideo,
  preloadGuidedWorkoutVideo,
  releaseMethodologyVideoPlayer,
  releaseGuidedWorkoutVideoPlayer,
} from '../onboarding/onboardingVideoPreload';
import { QuestionStepScreen } from '../components/onboarding/QuestionStepScreen';
import { DevFunnelNavigator } from '../components/onboarding/DevFunnelNavigator';
import { AnimatedStepContainer } from '../components/onboarding/AnimatedStepContainer';
import { colors } from '../theme/tokens';
import { OnboardingScreen } from './OnboardingScreen';
import { SocialProofScreen } from './SocialProofScreen';
import { AnalyzingScreen } from './AnalyzingScreen';
import { PlanReadyScreen } from './PlanReadyScreen';
import { NameStepScreen } from './onboarding/NameStepScreen';
import { WelcomeInterstitialScreen } from './onboarding/WelcomeInterstitialScreen';
import { EvolutionInterstitialScreen } from './onboarding/EvolutionInterstitialScreen';
import { MethodologyInterstitialScreen } from './onboarding/MethodologyInterstitialScreen';
import { GuidedWorkoutInterstitialScreen } from './onboarding/GuidedWorkoutInterstitialScreen';
import { AjFitProgressInterstitialScreen } from './onboarding/AjFitProgressInterstitialScreen';
import type { Quiz } from '../state/AppState';

export function OnboardingFunnelScreen({
  mode,
  onAuthRequested,
  onForcedQuestionnaireDone,
}: {
  mode: OnboardingFunnelMode;
  onAuthRequested: (ctx: OnboardingAuthContext) => void;
  onForcedQuestionnaireDone: () => void | Promise<void>;
}) {
  const { t } = useTranslation('quiz');
  const funnel = useOnboardingFunnel(mode);
  const { currentStepId, name, setName, quiz, setQuiz, progress, goNext, goBack, canGoBack, jumpTo } = funnel;

  const setAnswer = (id: keyof Quiz, value: unknown) => setQuiz({ ...quiz, [id]: value } as Quiz);

  // Two steps ahead of each video interstitial, warm up its player so the
  // native decoder has already opened the local asset by the time the user
  // gets there — see onboardingVideoPreload.ts:
  //   height → weight → interstitial_methodology
  //   duration → place → interstitial_guidedWorkout
  // Neither preload is tied to the interstitial's own unmount, so a dev
  // jump or revisit doesn't pay the decoder-init cost twice.
  useEffect(() => {
    if (currentStepId === 'height') preloadMethodologyVideo();
    if (currentStepId === 'duration') preloadGuidedWorkoutVideo();
    // Methodology is strictly before Guided Workout in every funnel
    // sequence, so once the user reaches this interstitial its player is no
    // longer needed for forward navigation — release it here instead of
    // keeping both decoders warm at once. A back-navigation past `height`
    // re-triggers the preload above (idempotent), paying the decoder cost
    // again — an acceptable trade for not holding two live decoders
    // simultaneously through most of the funnel's remaining length.
    if (currentStepId === 'interstitial_guidedWorkout') releaseMethodologyVideoPlayer();
  }, [currentStepId]);

  // Safety net for whichever player(s) never got released above — e.g. the
  // user abandons the funnel before ever reaching interstitial_guidedWorkout.
  useEffect(
    () => () => {
      releaseMethodologyVideoPlayer();
      releaseGuidedWorkoutVideoPlayer();
    },
    [],
  );

  const handlePlanContinue = () => {
    logOnboardingEvent({ name: 'plan_ready_cta_pressed' });
    if (mode === 'forcedQuestionnaire') {
      void onForcedQuestionnaireDone();
      return;
    }
    onAuthRequested({ origin: 'planCompleted', name });
  };

  const renderQuestion = (id: keyof Quiz) => {
    const question = FUNNEL_QUESTIONS[currentStepId];
    if (!question) return null;
    const nextId = getNextStepId(currentStepId, mode);
    const isLastQuestion = nextId === 'analyzing';
    return (
      <QuestionStepScreen
        // Forces a genuine remount between any two questions — without this,
        // React reuses the same `QuestionStepScreen` instance (same type,
        // same tree position) across question→question, which is what made
        // it impossible for the outer step transition to apply to it like
        // every other step. Safe: no answer state lives in this component or
        // its answer-control children (ChoiceGrid/ChoiceList/MultiList/
        // NumberWheel/BirthDateWheel) — everything real is `quiz[id]` in
        // `AppState`, persisted independently of this component's lifecycle.
        key={currentStepId}
        question={question}
        value={quiz[id]}
        onChange={(v) => setAnswer(id, v)}
        onNext={goNext}
        onBack={canGoBack ? goBack : null}
        stepNumber={progress.current}
        totalSteps={progress.total}
        ctaLabel={isLastQuestion ? t('actions.generatePlan') : undefined}
      />
    );
  };

  let content: React.ReactNode = null;

  switch (currentStepId) {
    case 'presentation':
      content = (
        <OnboardingScreen
          onDone={goNext}
          onLogin={() => onAuthRequested({ origin: 'directLogin' })}
        />
      );
      break;
    case 'name':
      content = (
        <NameStepScreen name={name} onChangeName={setName} progress={progress} onNext={goNext} />
      );
      break;
    case 'welcome':
      content = <WelcomeInterstitialScreen name={name} onContinue={goNext} />;
      break;
    case 'motivation':
      content = renderQuestion('motivation');
      break;
    case 'goal':
      content = renderQuestion('goal');
      break;
    case 'level':
      content = renderQuestion('level');
      break;
    case 'interstitial_evolution':
      content = <EvolutionInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'sex':
      content = renderQuestion('sex');
      break;
    case 'birthDate':
      content = renderQuestion('birthDate');
      break;
    case 'height':
      content = renderQuestion('height');
      break;
    case 'weight':
      content = renderQuestion('weight');
      break;
    case 'interstitial_methodology':
      content = <MethodologyInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'days':
      content = renderQuestion('days');
      break;
    case 'duration':
      content = renderQuestion('duration');
      break;
    case 'place':
      content = renderQuestion('place');
      break;
    case 'interstitial_guidedWorkout':
      content = <GuidedWorkoutInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'limits':
      content = renderQuestion('limits');
      break;
    case 'muscleFocus':
      content = renderQuestion('muscleFocus');
      break;
    case 'interstitial_ajFitProgress':
      content = <AjFitProgressInterstitialScreen name={name} progress={progress} onContinue={goNext} />;
      break;
    case 'socialProof':
      content = <SocialProofScreen onDone={goNext} />;
      break;
    case 'commitment':
      content = renderQuestion('commitment');
      break;
    case 'analyzing':
      content = <AnalyzingScreen name={name} onDone={goNext} />;
      break;
    case 'plan':
      content = <PlanReadyScreen name={name} onContinue={handlePlanContinue} />;
      break;
    // 'auth' and 'paywall' are never rendered here — they're separate
    // RootScreenId values App.tsx owns directly. They exist in
    // ONBOARDING_STEPS purely for progress/dev-nav bookkeeping.
    default:
      content = null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AnimatedStepContainer stepKey={currentStepId}>{content}</AnimatedStepContainer>
      {__DEV__ && <DevFunnelNavigator currentStepId={currentStepId} onJump={jumpTo} />}
    </View>
  );
}
