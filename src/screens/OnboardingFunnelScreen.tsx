import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOnboardingFunnel, type OnboardingFunnelMode } from '../onboarding/useOnboardingFunnel';
import { FUNNEL_QUESTIONS } from '../onboarding/questionDefs';
import { getNextStepId, MAX_MUSCLE_FOCUS } from '../onboarding/steps';
import {
  muscleFocusValuesForVisualGroups,
  visualGroupsForMuscleFocusValues,
  type MuscleFocusVisualGroup,
} from '../onboarding/muscleFocusBodyMap';
import type { OnboardingAuthContext } from '../onboarding/authContext';
import { logOnboardingEvent } from '../onboarding/onboardingAnalytics';
import { logInfo } from '../lib/logger';
import {
  preloadMethodologyVideo,
  preloadGuidedWorkoutVideo,
  releaseMethodologyVideoPlayer,
  releaseGuidedWorkoutVideoPlayer,
} from '../onboarding/onboardingVideoPreload';
import { QuestionStepScreen } from '../components/onboarding/QuestionStepScreen';
import { ScheduleModeLink, WeeklySchedulePicker } from '../components/onboarding/WeeklySchedulePicker';
import { MuscleFocusBodyMapPicker } from '../components/onboarding/MuscleFocusBodyMapPicker';
import { isWeeklyScheduleComplete, type WeeklyScheduleValue } from '../onboarding/weeklyScheduleSelection';
import { DevFunnelNavigator } from '../components/onboarding/DevFunnelNavigator';
import { AnimatedStepContainer } from '../components/onboarding/AnimatedStepContainer';
import { useTheme } from '../theme';
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
import { answerValueForStep, cleanApplicableAnswers, updateQuizAnswer } from '../lib/questionnaireSchema';
import { onboardingSafetyBlock } from '../onboarding/onboardingSafetyGate';

export function OnboardingFunnelScreen({
  mode,
  onAuthRequested,
  onForcedQuestionnaireDone,
}: {
  mode: OnboardingFunnelMode;
  onAuthRequested: (ctx: OnboardingAuthContext) => void;
  onForcedQuestionnaireDone: () => void | Promise<void>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const funnel = useOnboardingFunnel(mode);
  const { currentStepId, name, setName, quiz, setQuiz, progress, goNext, goBack, canGoBack, jumpTo, hydrated } = funnel;
  // Exact anatomy is UI state; `quiz.muscleFocus` intentionally remains the
  // existing grouped persistence contract used by workout prescription.
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<MuscleFocusVisualGroup[]>(
    () => visualGroupsForMuscleFocusValues(quiz.muscleFocus),
  );
  // `quiz` for the anonymous funnel only reflects a resumed draft's real
  // answers after `hydrated` flips true (see useOnboardingFunnel) — the
  // lazy initializer above runs before that. Re-derive the visual selection
  // exactly once when hydration completes, so returning to an
  // already-answered `muscleFocus` step (draft resume, or forced
  // questionnaire re-entry) shows the body map as the user left it. Never
  // re-run after that: once the user starts toggling, `quiz.muscleFocus` is
  // a lossy *derived* projection of `selectedMuscleGroups` (arms collapses
  // three regions into one value), so re-syncing from it would fight the
  // user's own in-progress selection.
  const muscleFocusHydratedRef = useRef(false);
  useEffect(() => {
    if (muscleFocusHydratedRef.current || !hydrated) return;
    muscleFocusHydratedRef.current = true;
    setSelectedMuscleGroups(visualGroupsForMuscleFocusValues(quiz.muscleFocus));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, exactly when hydration completes
  }, [hydrated]);

  // Diagnostic only — unrelated to any functional behavior. A real E2E
  // reported this screen flashing for ~2s right after a purchase, with no
  // corresponding `navigation_gate_evaluated` log entry showing
  // `resolvedScreen: 'onboardingFunnel'` in that window — meaning the root
  // cause could not be confirmed from the central gate's own logging alone
  // (App.tsx). This pins down whether the central gate actually re-resolved
  // here (mount + `currentStepId`/`mode` would appear in the trace) versus
  // some other rendering artifact, on the next real occurrence.
  useEffect(() => {
    logInfo('navigation', 'onboarding_funnel_mounted', { mode, currentStepId });
    return () => logInfo('navigation', 'onboarding_funnel_unmounted', { mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAnswer = (id: typeof currentStepId, value: unknown) => setQuiz(updateQuizAnswer(quiz, id, value));
  const scheduleValue: WeeklyScheduleValue = {
    days: quiz.days,
    scheduleMode: quiz.scheduleMode,
    trainingDays: quiz.trainingDays,
  };
  const setSchedule = (value: WeeklyScheduleValue) => setQuiz(cleanApplicableAnswers({ ...quiz, ...value }));
  const setMuscleGroups = (groups: MuscleFocusVisualGroup[]) => {
    setSelectedMuscleGroups(groups);
    setAnswer('muscleFocus', muscleFocusValuesForVisualGroups(groups));
  };

  // Two steps ahead of each video interstitial, warm up its player so the
  // native decoder has already opened the local asset by the time the user
  // gets there — see onboardingVideoPreload.ts:
  //   height → weight → interstitial_methodology
  //   duration → place → interstitial_guidedWorkout
  // Neither preload is tied to the interstitial's own unmount, so a dev
  // jump or revisit doesn't pay the decoder-init cost twice.
  useEffect(() => {
    if (currentStepId === 'goal') preloadMethodologyVideo();
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

  const renderQuestion = () => {
    let question = FUNNEL_QUESTIONS[currentStepId];
    if (!question) return null;
    if (currentStepId === 'specialConditions' && quiz.sex !== 'f' && 'options' in question) {
      question = {
        ...question,
        options: question.options.filter((option) => option.v !== 'pregnancy' && option.v !== 'postpartum'),
      };
    }
    const isScheduleQuestion = currentStepId === 'days';
    const isMuscleFocusQuestion = currentStepId === 'muscleFocus';
    const nextId = getNextStepId(currentStepId, mode, quiz);
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
        value={answerValueForStep(quiz, currentStepId)}
        onChange={(v) => setAnswer(currentStepId, v)}
        onNext={goNext}
        onBack={canGoBack ? goBack : null}
        stepNumber={progress.current}
        totalSteps={progress.total}
        ctaLabel={isLastQuestion ? t('actions.generatePlan') : undefined}
        validateBeforeNext={() => onboardingSafetyBlock(currentStepId, quiz)}
        answerControl={isScheduleQuestion ? (
          <WeeklySchedulePicker value={scheduleValue} onChange={setSchedule} />
        ) : isMuscleFocusQuestion ? (
          <MuscleFocusBodyMapPicker
            value={selectedMuscleGroups}
            onChange={setMuscleGroups}
            maxSelections={MAX_MUSCLE_FOCUS}
          />
        ) : undefined}
        answerFooter={isScheduleQuestion ? (
          <ScheduleModeLink value={scheduleValue} onChange={setSchedule} />
        ) : undefined}
        centerAnswerControlOnScreen={isScheduleQuestion}
        stretchAnswerControl={isMuscleFocusQuestion}
        canContinueOverride={isScheduleQuestion
          ? isWeeklyScheduleComplete(scheduleValue)
          : isMuscleFocusQuestion
            ? true
            : undefined}
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
    case 'goal':
      content = renderQuestion();
      break;
    case 'level':
      content = renderQuestion();
      break;
    case 'interstitial_evolution':
      content = <EvolutionInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'sex':
      content = renderQuestion();
      break;
    case 'birthDate':
      content = renderQuestion();
      break;
    case 'height':
      content = renderQuestion();
      break;
    case 'weight':
      content = renderQuestion();
      break;
    case 'interstitial_methodology':
      content = <MethodologyInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'days':
      content = renderQuestion();
      break;
    case 'duration':
      content = renderQuestion();
      break;
    case 'place':
      content = renderQuestion();
      break;
    case 'equipment':
      content = renderQuestion();
      break;
    case 'interstitial_guidedWorkout':
      content = <GuidedWorkoutInterstitialScreen progress={progress} onContinue={goNext} />;
      break;
    case 'limits':
      content = renderQuestion();
      break;
    case 'specialConditions':
    case 'pregnancyWeeks':
    case 'pregnancyCare':
    case 'pregnancyWarningSigns':
    case 'postpartumContext':
    case 'postpartumSigns':
    case 'postpartumReturnClearance':
    case 'functionalSituations':
    case 'lipedemaScreening':
    case 'dizzinessScreening':
    case 'postSurgicalStatus':
    case 'postSurgicalRegion':
    case 'medicalRestrictionDetails':
      content = renderQuestion();
      break;
    case 'muscleFocus':
      content = renderQuestion();
      break;
    case 'interstitial_ajFitProgress':
      content = <AjFitProgressInterstitialScreen name={name} progress={progress} onContinue={goNext} />;
      break;
    case 'socialProof':
      content = <SocialProofScreen onDone={goNext} />;
      break;
    case 'commitment':
      content = renderQuestion();
      break;
    case 'analyzing':
      content = <AnalyzingScreen name={name} onDone={goNext} onReviewAnswers={goBack} />;
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
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AnimatedStepContainer stepKey={currentStepId}>{content}</AnimatedStepContainer>
      {__DEV__ && <DevFunnelNavigator currentStepId={currentStepId} onJump={jumpTo} />}
    </View>
  );
}
