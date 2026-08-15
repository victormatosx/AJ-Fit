import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState';
import {
  computeOnboardingProgress,
  getNextStepId,
  getPreviousStepId,
  isStepDevJumpable,
  type OnboardingStepId,
} from './steps';
import { buildDraft, draftToQuiz, readOnboardingDraft, writeOnboardingDraft } from './draftStorage';
import { logOnboardingEvent } from './onboardingAnalytics';

export type OnboardingFunnelMode = 'anonymous' | 'forcedQuestionnaire';
export type OnboardingProgress = { current: number; total: number };

/**
 * Drives the funnel's current step, progress, and anonymous-draft
 * persistence. `mode: 'forcedQuestionnaire'` is for an already-authenticated
 * user with no questionnaire yet (e.g. social login that skipped the
 * anonymous funnel) — it starts at `goal`, skips draft restore/writes
 * entirely (the draft concept only exists pre-auth), and follows
 * `FORCED_QUESTIONNAIRE_STEP_IDS`.
 */
export function useOnboardingFunnel(mode: OnboardingFunnelMode) {
  const { quiz, setQuiz } = useAppState();
  const [currentStepId, setCurrentStepId] = useState<OnboardingStepId>(
    mode === 'forcedQuestionnaire' ? 'goal' : 'presentation',
  );
  const [name, setName] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(mode === 'forcedQuestionnaire');
  const startedLogged = useRef(false);

  useEffect(() => {
    if (mode !== 'anonymous') return;
    let cancelled = false;
    (async () => {
      const draft = await readOnboardingDraft();
      if (cancelled) return;
      if (draft) {
        setQuiz(draftToQuiz(draft));
        setName(draft.name);
        setCurrentStepId(draft.currentStepId);
        logOnboardingEvent({ name: 'onboarding_resumed', stepId: draft.currentStepId });
      } else if (!startedLogged.current) {
        startedLogged.current = true;
        logOnboardingEvent({ name: 'onboarding_started' });
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount for the anonymous funnel only
  }, [mode]);

  // Fire-and-forget persistence — every step/name/answer change updates the
  // draft. Cheap (single AsyncStorage write) and never blocks navigation.
  useEffect(() => {
    if (mode !== 'anonymous' || !hydrated) return;
    void writeOnboardingDraft(buildDraft({ currentStepId, name, quiz }));
  }, [mode, hydrated, currentStepId, name, quiz]);

  const progress = computeOnboardingProgress(currentStepId, mode);

  const goNext = useCallback(() => {
    logOnboardingEvent({ name: 'onboarding_step_completed', stepId: currentStepId });
    const next = getNextStepId(currentStepId, mode);
    if (next) {
      setCurrentStepId(next);
      logOnboardingEvent({ name: 'onboarding_step_viewed', stepId: next });
    }
  }, [currentStepId, mode]);

  const canGoBack = getPreviousStepId(currentStepId, mode) !== null;

  const goBack = useCallback(() => {
    const prev = getPreviousStepId(currentStepId, mode);
    if (prev) setCurrentStepId(prev);
  }, [currentStepId, mode]);

  const jumpTo = useCallback((id: OnboardingStepId) => {
    if (!isStepDevJumpable(id)) return;
    setCurrentStepId(id);
  }, []);

  return {
    mode,
    currentStepId,
    name,
    setName,
    quiz,
    setQuiz,
    progress,
    goNext,
    goBack,
    canGoBack,
    jumpTo,
    hydrated,
  };
}
