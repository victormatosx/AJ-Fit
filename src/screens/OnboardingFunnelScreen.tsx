import { Alert, Keyboard, KeyboardAvoidingView, Platform, Text, Pressable, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { NutritionProfileQuestion } from './nutrition/NutritionProfileScreen';
import { canContinueProfileStep, isProfileDraftComplete, type ProfileStepId } from '../nutrition/ui/profileSteps';
import { nutritionDraftAnswers } from '../onboarding/nutritionDraft';
import { useUnits } from '../state/UnitsContext';
import {
  preferenceForUnit,
  unitForPreference,
  type DisplayUnit,
} from '../components/onboarding/unitDisplay';
import { validateCustomFoodInput } from '../services/nutritionFoods';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboardingFunnel, type OnboardingFunnelMode } from '../onboarding/useOnboardingFunnel';
import { FUNNEL_QUESTIONS } from '../onboarding/questionDefs';
import { getNextStepId, getStepSequence, MAX_MUSCLE_FOCUS } from '../onboarding/steps';
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
import { AjFunnelStage } from '../components/onboarding/AjFunnelStage';
import { AjFunnelStepPose } from '../components/onboarding/AjFunnelStepPose';
import { sectionKeyForStep, shouldReactToStep } from '../components/onboarding/ajFunnelChoreography';
import {
  nutritionFunnelQuestion,
  nutritionOptionKey,
  NUTRITION_TARGET_WEIGHT_RANGE,
} from '../components/onboarding/nutritionFunnelQuestions';
import { AqTextAction } from '../components/ui/AcquisitionControls';
import { formatWeightInputFromKg } from '../units/weightConversions';
import { ajReactionLine } from '../components/onboarding/ajReactionLines';
import type { LooseT } from '../components/onboarding/QuestionRenderer';
import { useTheme } from '../theme';
import { OnboardingScreen } from './OnboardingScreen';
import { SocialProofScreen } from './SocialProofScreen';
import { AnalyzingScreen } from './AnalyzingScreen';
import { PlanReadyScreen } from './PlanReadyScreen';
import { NameStepScreen } from './onboarding/NameStepScreen';
import { HealthIntegrationOnboardingScreen } from './onboarding/HealthIntegrationOnboardingScreen';
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
  const { t, i18n } = useTranslation('quiz');
  const { t: tn } = useTranslation('nutrition');
  const tnLoose = tn as unknown as LooseT;
  const { resolvedUnits } = useUnits();
  const [draftError, setDraftError] = useState(false);
  /**
   * Which unit the body measurement rulers are *displayed* in.
   *
   * Presentation only, and deliberately not persisted: the answers are
   * stored in cm and kg exactly as before, and the app-wide units
   * preference (Settings) is not something the questionnaire writes — the
   * person filling it in is usually not signed in yet. It is seeded from
   * that preference, which `UnitsProvider` has already resolved against the
   * device locale, so an en-US phone opens on FT/LB without anyone asking.
   *
   * Height and weight are tracked separately (someone may well think in
   * feet and kilograms), but the two weight steps share one entry so that
   * picking LB for the current weight carries into the target weight.
   */
  const [heightUnit, setHeightUnit] = useState<DisplayUnit>(() =>
    unitForPreference('height', resolvedUnits));
  const [weightDisplayUnit, setWeightDisplayUnit] = useState<DisplayUnit>(() =>
    unitForPreference('weight', resolvedUnits));
  const measurementUnitFor = (stepId: string): DisplayUnit | null => {
    if (stepId === 'height') return heightUnit;
    if (stepId === 'weight' || stepId === 'nutrition_targetWeightKg') return weightDisplayUnit;
    return null;
  };
  const setMeasurementUnit = (stepId: string) => (next: DisplayUnit) => {
    if (stepId === 'height') setHeightUnit(next);
    else setWeightDisplayUnit(next);
  };
  const funnel = useOnboardingFunnel(mode);
  const {
    currentStepId, name, setName, healthIntegrationChoice, setHealthIntegrationChoice,
    quiz, setQuiz, progress, goNext, goBack, canGoBack, jumpTo, hydrated,
  } = funnel;
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

  const handlePlanContinue = async () => {
    logOnboardingEvent({ name: 'plan_ready_cta_pressed' });
    if (mode === 'forcedQuestionnaire') {
      // healthIntegration never appears in this mode (see steps.ts) — goes
      // straight to the done callback, unchanged from before Fase 5.
      void onForcedQuestionnaireDone();
      return;
    }
    // healthIntegration now sits earlier in the funnel (see steps.ts), so
    // 'plan' is the last step before auth — call onAuthRequested directly
    // instead of goNext().
    try {
      await funnel.flushDraft();
      onAuthRequested({ origin: 'planCompleted', name });
    } catch { setDraftError(true); }
  };

  /**
   * The mono kicker above a question title. The map lives in
   * `ajFunnelChoreography`; the funnel resolves it to real copy because it is
   * the layer that owns the step identity.
   */
  // Keys composed from a step id or an answer can't be checked against the
  // generated key union, which is the same reason `QuestionRenderer` exports
  // `LooseT`.
  const tLoose = t as unknown as LooseT;

  const sectionLabelFor = (stepId: typeof currentStepId): string | null => {
    const key = sectionKeyForStep(stepId);
    return key ? tLoose(`sections.${key}`) : null;
  };

  /**
   * What AJ says back after a key answer. Assembled here, not inside the
   * question component, because every input it needs is an answer this screen
   * already holds — and because the only count it uses (how many conditional
   * health steps became applicable) comes from `getStepSequence`, the real
   * sequence resolver, rather than from a recount.
   */
  const CONDITIONAL_HEALTH_STEP_IDS = [
    'lipedemaScreening', 'dizzinessScreening', 'postSurgicalStatus',
    'postSurgicalRegion', 'pregnancyWeeks', 'pregnancyCare', 'pregnancyWarningSigns',
    'postpartumContext', 'postpartumSigns', 'postpartumReturnClearance',
    'functionalSituations', 'medicalRestrictionDetails',
  ] as const;

  const reactionLineFor = (stepId: typeof currentStepId): string | null => {
    const allergens = nutritionDraftAnswers(funnel.nutrition).excludedAllergens ?? [];
    const hasContent = stepId === 'nutrition_excludedAllergens'
      ? allergens.length > 0
      : true;
    if (!shouldReactToStep(stepId, hasContent)) return null;

    const sequence = getStepSequence(mode, quiz);
    const applicableHealthStepCount = CONDITIONAL_HEALTH_STEP_IDS
      .filter((id) => sequence.includes(id)).length;

    return ajReactionLine({
      stepId,
      t: tLoose,
      exists: (key) => i18n.exists(key),
      name,
      applicableHealthStepCount,
      answers: {
        heightCm: quiz.height,
        weightKg: quiz.weight,
        goal: quiz.goal,
        scheduleMode: quiz.scheduleMode,
        trainingDayCount: quiz.days,
        trainingDayLabels: (quiz.trainingDays ?? []).map((day) => tLoose(`trainingDays.options.${day}`)),
        specialConditions: quiz.specialConditions,
        allergens,
        varietyPreference: nutritionDraftAnswers(funnel.nutrition).varietyPreference,
        commitment: quiz.commitment,
      },
    });
  };

  /**
   * The CTA's LABEL reflects what confirming will mean when the answer is
   * empty; its enabled state is untouched and still comes from
   * `canContinueQuestion` / `canContinueOverride`. The design asks for this on
   * the steps where an empty answer is a legitimate choice rather than an
   * unfinished one — which is why it has to be reachable from the nutrition
   * branch too, not only from `renderQuestion`.
   */
  const emptyAnswerCtaLabel = (): string | undefined => {
    if (getNextStepId(currentStepId, mode, quiz) === 'analyzing') return t('actions.generatePlan');
    if (currentStepId === 'muscleFocus' && selectedMuscleGroups.length === 0) {
      return t('actions.skipMuscleFocus');
    }
    const nutritionDraft = nutritionDraftAnswers(funnel.nutrition);
    if (currentStepId === 'nutrition_excludedAllergens'
      && (nutritionDraft.excludedAllergens ?? []).length === 0) {
      return t('actions.noAllergens');
    }
    if (currentStepId === 'nutrition_supplements'
      && (nutritionDraft.supplements ?? []).length === 0) {
      return t('actions.noSupplements');
    }
    // The two catalogue searches are optional: with nothing chosen the CTA
    // says so. Only the LABEL changes — `canContinueProfileStep` returns true
    // either way, and the handler is the same.
    if (currentStepId === 'nutrition_preferredFoodIds') {
      return (nutritionDraft.preferredFoodIds ?? []).length === 0
        ? tn('profile.actions.skip') : t('actions.confirm');
    }
    if (currentStepId === 'nutrition_excludedFoodIds') {
      return (nutritionDraft.excludedFoodIds ?? []).length === 0
        ? tn('profile.actions.skip') : t('actions.confirm');
    }
    return t('actions.confirm');
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
        ctaLabel={emptyAnswerCtaLabel()}
        sectionLabel={sectionLabelFor(currentStepId)}
        reactionLine={reactionLineFor(currentStepId)}
        measurementUnit={measurementUnitFor(currentStepId)}
        onMeasurementUnitChange={setMeasurementUnit(currentStepId)}
        validateBeforeNext={() => onboardingSafetyBlock(currentStepId, quiz)}
        answerControl={isScheduleQuestion ? (
          <WeeklySchedulePicker value={scheduleValue} onChange={setSchedule} />
        ) : isMuscleFocusQuestion && quiz.sex ? (
          <MuscleFocusBodyMapPicker
            sex={quiz.sex}
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

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  if (funnel.pendingTransfer) return <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20, backgroundColor: theme.colors.background }}>
    <Text style={{ color: theme.colors.textPrimary }}>{tn('onboarding.pendingAccount')}</Text>
    <Pressable onPress={() => onAuthRequested({ origin: 'directLogin' })}><Text style={{ color: theme.colors.primaryEmphasis }}>{tn('onboarding.signIn')}</Text></Pressable>
    <Pressable onPress={() => Alert.alert(tn('onboarding.discardTitle'), tn('onboarding.discardBody'), [
      { text: tn('onboarding.cancel'), style: 'cancel' },
      { text: tn('onboarding.discard'), style: 'destructive', onPress: () => { void funnel.discardPendingTransfer().catch(() => setDraftError(true)); } },
    ])}><Text style={{ color: theme.colors.textMuted }}>{tn('onboarding.discard')}</Text></Pressable>
  </View>;

  let content: React.ReactNode = null;
  if (currentStepId.startsWith('nutrition_') && quiz.goal) {
    const step = currentStepId.slice('nutrition_'.length) as ProfileStepId;
    const draft = nutritionDraftAnswers(funnel.nutrition);
    // The target weight has always been stored as text plus the units it was
    // typed in, so "imperial" is an existing, valid stored form here — the
    // step's own KG/LB selector simply becomes what decides it, in place of
    // the app-wide preference. `nutritionDraftAnswers` re-parses using the
    // units stamped beside the text, so the kilogram value is read back
    // correctly whichever unit was used to write it.
    const nutritionUnits = preferenceForUnit(weightDisplayUnit);
    const setAnswers = (next: Partial<typeof draft>) =>
      funnel.setNutrition((prev) => ({ ...prev, answers: { ...prev.answers, ...next }, completed: false }));

    // The nutrition block renders through the SAME controls as the training
    // questions (see `nutritionFunnelQuestions`). Only the two catalogue
    // searches still need their own composed control.
    const nutritionQuestion = nutritionFunnelQuestion(step, currentStepId);
    const subtitleKey = `profile.questions.${step}.subtitle`;

    /**
     * The target weight is stored as TEXT plus the units it was typed in —
     * `nutritionDraftAnswers` re-parses that into kilograms and overwrites
     * whatever `answers.targetWeightKg` holds. So the ruler writes the text,
     * exactly as the keyboard input it replaces did, and the stored contract
     * is untouched.
     */
    const writeTargetWeight = (kilograms: number) =>
      funnel.setNutrition((prev) => ({
        ...prev,
        targetWeightText: formatWeightInputFromKg(kilograms, nutritionUnits),
        targetWeightUnits: nutritionUnits,
        completed: false,
      }));

    const nutritionValue = (): unknown => {
      switch (step) {
        case 'nutritionGoalCategory': return draft.nutritionGoalCategory ?? null;
        case 'progressionPace': return draft.progressionPace ?? null;
        case 'nonTrainingActivityLevel': return draft.nonTrainingActivityLevel ?? null;
        case 'varietyPreference': return draft.varietyPreference ?? null;
        case 'mealSlots': return draft.mealSlots ?? [];
        case 'excludedAllergens': return draft.excludedAllergens ?? [];
        case 'supplements': return draft.supplements ?? [];
        // A ruler always shows a number. With no target recorded the user's
        // current weight is the honest starting point — it is where they are,
        // not an answer, and nothing is written until they confirm.
        case 'targetWeightKg':
          return draft.targetWeightKg ?? quiz.weight ?? NUTRITION_TARGET_WEIGHT_RANGE.default;
        default: return null;
      }
    };

    const writeNutritionValue = (value: unknown) => {
      switch (step) {
        case 'nutritionGoalCategory': return setAnswers({ nutritionGoalCategory: value as never });
        case 'progressionPace': return setAnswers({ progressionPace: value as never });
        case 'nonTrainingActivityLevel': return setAnswers({ nonTrainingActivityLevel: value as never });
        case 'varietyPreference': return setAnswers({ varietyPreference: value as never });
        case 'mealSlots': return setAnswers({ mealSlots: value as never });
        case 'excludedAllergens': return setAnswers({ excludedAllergens: value as never });
        case 'supplements': return setAnswers({ supplements: value as never });
        case 'targetWeightKg': return writeTargetWeight(value as number);
        default: return undefined;
      }
    };

    const advance = () => {
      Keyboard.dismiss();
      if (step === 'varietyPreference') {
        if (!isProfileDraftComplete(quiz.goal!, draft)) return;
        funnel.setNutrition({ ...funnel.nutrition, completed: true });
      }
      goNext();
    };

    content = <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <QuestionStepScreen key={currentStepId}
        question={nutritionQuestion ?? { id: currentStepId, kind: 'choice', options: [] }}
        title={tn(`profile.questions.${step}.title`)}
        subtitle={tnLoose(subtitleKey, { defaultValue: '' }) || null}
        value={nutritionQuestion ? nutritionValue() : null}
        onChange={nutritionQuestion ? writeNutritionValue : () => {}}
        onBack={canGoBack ? goBack : null}
        stepNumber={progress.current} totalSteps={progress.total}
        canContinueOverride={canContinueProfileStep(step, draft, quiz.goal)}
        sectionLabel={sectionLabelFor(currentStepId)}
        reactionLine={reactionLineFor(currentStepId)}
        ctaLabel={emptyAnswerCtaLabel()}
        optionLabel={(option) => tnLoose(nutritionOptionKey(step, option))}
        bodyWeightWheel={step === 'targetWeightKg'}
        measurementUnit={measurementUnitFor(currentStepId)}
        onMeasurementUnitChange={setMeasurementUnit(currentStepId)}
        answerFooter={step === 'targetWeightKg' ? (
          <AqTextAction
            label={t('actions.skipTargetWeight')}
            onPress={() => {
              // Clearing the text is what records "no target" — the same
              // thing the old skip row did.
              funnel.setNutrition((prev) => ({ ...prev, targetWeightText: '', completed: false }));
              advance();
            }}
          />
        ) : undefined}
        onNext={advance}
        // The catalogue searches fill the step from the title down, instead
        // of floating in the middle of it — they are a field plus a growing
        // list, not a short answer.
        stretchAnswerControl={!nutritionQuestion}
        answerControl={nutritionQuestion ? undefined : (
          <NutritionProfileQuestion step={step} draft={draft} inputUnits={nutritionUnits} hideTitle variant="onboarding" currentWeightKg={quiz.weight}
            targetWeightText={funnel.nutrition.targetWeightText}
            onTargetWeightText={(targetWeightText) => funnel.setNutrition((prev) => ({ ...prev, targetWeightText, targetWeightUnits: nutritionUnits }))}
            onChange={(answers) => funnel.setNutrition((prev) => ({ ...prev, answers, completed: false }))}
            localFoods={funnel.nutrition.customFoods}
            onCreateLocalFood={async (input) => {
              validateCustomFoodInput(input);
              const id = `custom_${randomUUID()}`;
              funnel.setNutrition((prev) => ({ ...prev, customFoods: [...prev.customFoods, { id, ...input }] }));
              return id;
            }} />
        )}
      />
    </KeyboardAvoidingView>;
  }

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
        <NameStepScreen
          name={name}
          onChangeName={setName}
          progress={progress}
          onNext={goNext}
          onBack={canGoBack ? goBack : null}
        />
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
      content = <AnalyzingScreen onDone={goNext} onReviewAnswers={goBack} />;
      break;
    case 'plan':
      content = (
        <PlanReadyScreen
          name={name}
          onContinue={handlePlanContinue}
          // Read-only: the Plan panel presents the nutrition answers, it never
          // writes them back. The draft stays owned by the funnel hook.
          nutrition={funnel.nutrition}
        />
      );
      break;
    case 'healthIntegration':
      content = (
        <HealthIntegrationOnboardingScreen
          choice={healthIntegrationChoice}
          onChoose={setHealthIntegrationChoice}
          progress={progress}
          onBack={canGoBack ? goBack : null}
          onNext={goNext}
        />
      );
      break;
    // 'auth' and 'paywall' are never rendered here — they're separate
    // RootScreenId values App.tsx owns directly. They exist in
    // ONBOARDING_STEPS purely for progress/dev-nav bookkeeping.
    default:
      // Nutrition steps are composed above. Keep that content instead of
      // replacing it with an empty screen; root-owned steps start as null.
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* The mascot is mounted OUTSIDE `AnimatedStepContainer` on purpose:
          that container remounts its subtree on every step, and an AJ inside
          it would be rebuilt 44 times over the funnel, replaying his entrance
          on each question and making "travel from the previous pose"
          impossible to express. See `AjFunnelStage`. */}
      <AjFunnelStage>
        {/* Outside the remounting container too: the pose declaration for a
            step must survive that step's own content being rebuilt. */}
        <AjFunnelStepPose stepId={currentStepId} />
        <AnimatedStepContainer stepKey={currentStepId}>{content}</AnimatedStepContainer>
      </AjFunnelStage>
      {draftError ? <Text accessibilityRole="alert" style={{ color: theme.colors.formErrorText }}>{tn('profile.errors.saveFailed')}</Text> : null}
      {__DEV__ && <DevFunnelNavigator currentStepId={currentStepId} onJump={jumpTo} />}
    </View>
  );
}
