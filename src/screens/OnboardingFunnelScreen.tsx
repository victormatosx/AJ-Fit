import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOnboardingFunnel, type OnboardingFunnelMode } from '../onboarding/useOnboardingFunnel';
import { FUNNEL_QUESTIONS } from '../onboarding/questionDefs';
import { getNextStepId } from '../onboarding/steps';
import type { OnboardingAuthContext } from '../onboarding/authContext';
import { logOnboardingEvent } from '../onboarding/onboardingAnalytics';
import { QuestionStepScreen } from '../components/onboarding/QuestionStepScreen';
import { DevFunnelNavigator } from '../components/onboarding/DevFunnelNavigator';
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
import { EquipmentPicker } from '../components/fitness/EquipmentPicker';
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
      content = <WelcomeInterstitialScreen name={name} progress={progress} onContinue={goNext} />;
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
    case 'equipment': {
      const stepLabel = t('equipment.stepLabel', {
        current: String(progress.current).padStart(2, '0'),
        total: String(progress.total).padStart(2, '0'),
      }).toUpperCase();
      content = (
        <EquipmentPicker
          value={quiz.equipment}
          onChange={(v) => setAnswer('equipment', v)}
          onDone={goNext}
          onBack={goBack}
          stepLabel={stepLabel}
        />
      );
      break;
    }
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
    <View style={{ flex: 1 }}>
      {content}
      {__DEV__ && <DevFunnelNavigator currentStepId={currentStepId} onJump={jumpTo} />}
    </View>
  );
}
