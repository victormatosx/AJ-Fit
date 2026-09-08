import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState';
import {
  computeOnboardingProgress,
  getNextStepId,
  getPreviousStepId,
  getStepSequence,
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
 * user with no (or an incomplete) questionnaire (e.g. social login that
 * skipped the anonymous funnel, or a repair re-entry — see
 * `useWorkoutReadinessGate`'s `needsQuestionnaire` status) — it skips draft
 * restore/writes entirely (the draft concept only exists pre-auth) and
 * follows `FORCED_QUESTIONNAIRE_STEP_IDS`.
 *
 * The initial step is always `getStepSequence(mode)[0]` — NEVER a hardcoded
 * literal. This file previously hardcoded `'goal'` as the forced-mode start,
 * while `FORCED_QUESTIONNAIRE_STEP_IDS` (steps.ts) had `sex`, `birthDate`,
 * `height`, `weight` ahead of `goal` — so every Fluxo B user silently skipped
 * those four questions (never shown, not even reachable by going back from
 * `goal`), including `sex`, a hard-required prescription-engine field
 * (`prescriptionInputErrors`, workoutPrescription/input.ts). That produced
 * `NEEDS_QUESTIONNAIRE_UPDATE` at first-app-entry for every Fluxo B user, no
 * matter how completely they answered what was actually shown to them.
 * Deriving the start from the SAME sequence function `getNextStepId`/
 * `getPreviousStepId`/`computeOnboardingProgress` already use makes this
 * class of drift structurally impossible going forward.
 */
export function useOnboardingFunnel(mode: OnboardingFunnelMode) {
  const { quiz, setQuiz } = useAppState();
  const [currentStepId, setCurrentStepId] = useState<OnboardingStepId>(
    () => getStepSequence(mode)[0],
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

  const progress = computeOnboardingProgress(currentStepId, mode, quiz);

  const goNext = useCallback(() => {
    logOnboardingEvent({ name: 'onboarding_step_completed', stepId: currentStepId });
    const next = getNextStepId(currentStepId, mode, quiz);
    if (next) {
      setCurrentStepId(next);
      logOnboardingEvent({ name: 'onboarding_step_viewed', stepId: next });
    }
  }, [currentStepId, mode, quiz]);

  const canGoBack = getPreviousStepId(currentStepId, mode, quiz) !== null;

  const goBack = useCallback(() => {
    const prev = getPreviousStepId(currentStepId, mode, quiz);
    if (prev) setCurrentStepId(prev);
  }, [currentStepId, mode, quiz]);

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
