import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, Text, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { randomUUID } from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from '../components/ui/Icon';
import { Card, HudCorners } from '../components/ui/Card';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { CtaButton } from '../components/ui/CtaButton';
import { ScreenBg } from '../components/ui/ScreenBg';
import { darkTheme, useTheme } from '../theme';
import { useAppState, TabId, type Sex, type ScheduleMode, type Weekday } from '../state/AppState';
import { useAuth } from '../state/AuthContext';
import { PremiumActionProvider } from '../state/PremiumActionContext';
import { PremiumAction } from '../components/premium/PremiumAction';
import { versionedPhotoURL } from '../lib/profilePhotoUrl';
import { PASSWORD_PROVIDER_ID } from '../lib/authProviders';
import { HomeScreen } from './HomeScreen';
import { WorkoutScreen } from './WorkoutScreen';
import { ProgressScreen } from './ProgressScreen';
import { ProfileScreen } from './ProfileScreen';
import { AssessmentScreen } from './AssessmentScreen';
import { SettingsScreen } from './SettingsScreen';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { AccountSettingsScreen } from './AccountSettingsScreen';
import { SecurityScreen } from './SecurityScreen';
import { ChangePasswordScreen } from './ChangePasswordScreen';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { MyPlanScreen } from './MyPlanScreen';
import { PaywallScreen } from './PaywallScreen';
import { SubscriptionCenterScreen } from './SubscriptionCenterScreen';
import { HelpCenterScreen } from './HelpCenterScreen';
import { HelpArticleScreen } from './HelpArticleScreen';
import { SupportFormScreen } from './SupportFormScreen';
import { SupportSuccessScreen } from './SupportSuccessScreen';
import { SupportCasesScreen } from './SupportCasesScreen';
import { SupportCaseDetailScreen } from './SupportCaseDetailScreen';
import { useUnreadSupportCasesCount } from '../hooks/useUnreadSupportCasesCount';
import { setForegroundSupportCaseId } from '../services/pushNotifications';
import type { HelpArticle, SupportTicketType } from '../types/support';
import { PersistentScreen } from '../components/navigation/PersistentScreen';
import { LoadProgressProvider } from '../loadProgress/LoadProgressContext';
import { usePrewarmQueue } from '../components/navigation/usePrewarmQueue';
import { useSubscription } from '../hooks/useSubscription';
import {
  INITIAL_PAYWALL_PREMIUM_RETURN_STATE,
  resolvePaywallPremiumReturn,
} from '../lib/paywallPremiumReturn';
import { useWorkoutPrescription } from '../workoutPrescription/useWorkoutPrescription';
import type { FinalWorkoutPlan, PrescriptionResult } from '../workoutPrescription/types';
import { canRetryGeneration, prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { loadWorkoutProgramSnapshot, type WorkoutProgramSnapshot } from '../services/workoutPrograms';
import {
  localDateInTimezone,
  advancedWorkoutTarget,
  useWorkoutSchedule,
  weekdayOfLocalDate,
  type MissDecision,
  type MissedSessionDecisionIdentity,
  type ScheduleResolution,
  type AdvancedWorkoutTarget,
} from '../scheduleEngine';
import {
  missedDecisionIdentity,
  sameMissedDecision,
} from '../scheduleEngine/missedDecisionResolution';
import { MissedSessionDecisionModal } from '../components/schedule/MissedSessionDecisionModal';
import { TreinoScreen, type RepositionOutcome } from './TreinoScreen';
import { TreinoAgendaSheet, type AgendaSaveOutcome } from './TreinoAgendaSheet';
import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import { WorkoutExecutionPendingModal } from '../components/workout/WorkoutExecutionPendingModal';
import { FullScreenLoading } from '../components/ui/FullScreenLoading';
import { useWorkoutExecution, type WorkoutExecutionStartError } from '../workoutExecution/useWorkoutExecution';
import { useWorkoutSessionRecovery } from '../workoutExecution/useWorkoutSessionRecovery';
import { WorkoutSessionRecoveryModal } from '../components/workout/WorkoutSessionRecoveryModal';
import {
  abandonWorkoutExecution,
  loadWorkoutExecution,
  type PersistedWorkoutExecution,
} from '../services/workoutExecutions';
import {
  applyWorkoutCompletionNavigation,
  recoveryFinalizationMode,
  runWorkoutHomeProjectionSync,
  runWorkoutCompletionFollowUp,
  runWorkoutCompletionAttempt,
  runWorkoutCompletionSingleFlight,
  runWorkoutDiscardFlow,
  shouldRetryWorkoutCompletionOnForeground,
  type WorkoutCompletionResult,
} from '../workoutLifecycle/finishFlow';
import {
  classifyWorkoutFinalizationError,
  type WorkoutFinalizationErrorCategory,
} from '../workoutLifecycle/finalizationErrorClassification';
import {
  finalizeWorkoutSession,
  workoutFinalizationFailureStage,
  type FinalizeWorkoutSessionResult,
  type WorkoutFinalizationMode,
} from '../services/finalizeWorkoutSession';
import { subscribeToWorkoutFinalizationProgress } from '../services/workoutFinalizationProgress';
import { hasScheduledSessionCompletion, repositionScheduleCursor, saveScheduleConfig } from '../services/workoutSchedule';
import {
  furthestWorkoutFinalizationStage,
  type WorkoutFinalizationProgressStage,
} from '../workoutLifecycle/finalizationProgress';
import {
  createWorkoutFinalizationProgressAttempt,
  runWorkoutFinalizationWithBestEffortProgress,
  type WorkoutFinalizationProgressAttempt,
} from '../workoutLifecycle/finalizationRuntime';
import {
  loadAuthoritativelyCommittedFinalization,
  resolveAuthoritativeCardioFinisherPresence,
} from '../workoutLifecycle/finalizationRecovery';
import { clearCardioSession } from '../services/cardioSessionStorage';
import { useWorkoutEvolution } from '../workoutEvolution/useWorkoutEvolution';
import { useWorkoutActivitySnapshot } from '../home/useWorkoutActivitySnapshot';
import { useFrequencyWindow } from '../home/useFrequencyWindow';
import { useHomeStreak } from '../home/useHomeStreak';
import { useWidgetSnapshotSync } from '../widgets/useWidgetSnapshotSync';
import { deriveHomeInitialReadiness } from '../home/homeInitialReadiness';
import { useHomeInitialVisualReady } from '../home/useHomeInitialVisualReady';
import { canUseTodayActions, canWriteHomePresentationSnapshot, chooseHomeFrequencyPresentation, shouldUseSnapshotPlaceholders } from '../home/homePresentationPolicy';
import { adaptWorkoutProgram, processWorkoutLifecycleAfterSession } from '../services/workoutLifecycleApplication';
import {
  applyExerciseSubstitution,
  loadManualSubstitutionUserContext,
} from '../services/exerciseSubstitution';
import type { ManualSubstitutionUserContext } from '../services/exerciseSubstitutionCandidates';
import { workoutExercisesFromPlan, type ManualSubstitutionContextStatus } from './workoutScreenPlan';
import { EvolutionUnlockScreen } from './EvolutionUnlockScreen';
import { errorClass, errorCode, errorReason, logError, logInfo, logWarn } from '../lib/logger';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { useReducedMotionPreference } from '../lib/reducedMotion';
import { useDeepLinkIntent } from '../state/DeepLinkContext';
import { RestSessionProvider, useRestSession } from '../state/RestSessionContext';
import { recordPerfMark } from '../lib/perf';
import {
  projectCachedFrequency,
  readHomePresentationSnapshot,
  writeHomePresentationSnapshot,
  type HomePresentationSnapshot,
} from '../lib/homePresentationSnapshot';

type SupportRoute =
  | { name: 'help' }
  | { name: 'article'; article: HelpArticle }
  | { name: 'form'; type: SupportTicketType; subject?: string }
  | { name: 'success' }
  | { name: 'cases'; origin: 'home' | 'help' }
  | { name: 'case'; caseId: string; casesOrigin: 'home' | 'help' };

/** Logs the first committed workout-tab surface for one confirm attempt. */
function WorkoutStartVisibilityMetric({
  attempt,
  onMeasured,
}: {
  attempt: { id: number; requestedAtMs: number; sessionIndex: number };
  onMeasured: () => void;
}) {
  useEffect(() => {
    const visibleAtMs = Date.now();
    logInfo('workout_execution', 'start_surface_visible', {
      attemptId: attempt.id,
      sessionIndex: attempt.sessionIndex,
      durationMs: visibleAtMs - attempt.requestedAtMs,
    });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      logInfo('workout_performance', 'preparing_visible', {
        timestampMs: visibleAtMs,
        attemptId: attempt.id,
        sessionIndex: attempt.sessionIndex,
        durationMs: visibleAtMs - attempt.requestedAtMs,
      });
    }
    onMeasured();
  }, [attempt.id, attempt.requestedAtMs, attempt.sessionIndex, onMeasured]);
  return null;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Shared full-viewport geometry for every persistent screen — tabs and
 * overlays alike (docs/23_navegacao_e_lifecycle.md §3/§14). Defined once so
 * `activeStyle` and the `materialized` inactive geometry PersistentScreen
 * derives from it can never drift apart per screen (the exact class of bug
 * "prewarm layout A, then a different layout B on activation" would
 * reintroduce). Tabs need no `zIndex` — at most one of them is ever opaque
 * (`active`) at a time, and `opacity: 0` siblings never occlude regardless
 * of stacking order. Overlays add their own `zIndex` on top of this base.
 */
const FULL_BLEED = StyleSheet.create({
  tab: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlayZ40: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 },
  overlayZ50: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 },
  overlayZ60: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 60 },
  overlayZ70: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 70 },
});

/**
 * FASE 4 (docs/13_assinaturas_e_billing.md): `showPremium` — the on-demand
 * Paywall mount this file already had (originally only reachable from the
 * Subscription Center's "renovar") — now lives in this thin outer
 * component so `PremiumActionProvider` can wire its `onRequestUpgrade` to
 * the exact same trigger, instead of mounting a second `<PaywallScreen>`.
 * Everything else about AppShell is unchanged and lives in
 * `AppShellContent`, which reads `usePremiumAction()` from the provider
 * this wraps it in.
 */
export function AppShell({ onHomeReady }: { onHomeReady?: () => void }) {
  const [showPremium, setShowPremium] = useState(false);
  const { user, questionnaire } = useAuth();
  const sex = questionnaire?.answers.sex;

  // App.tsx normally guarantees this before mounting AppShell. Keep this
  // defensive boundary neutral so an unexpected intermediate/legacy state
  // can never flash the male anatomy before the questionnaire resolves.
  if (!sex) return <FullScreenLoading />;

  return (
    <PremiumActionProvider onRequestUpgrade={() => setShowPremium(true)}>
      <LoadProgressProvider uid={user?.uid ?? null}>
        <RestSessionProvider key={user?.uid ?? 'signed-out'}>
          <AppShellContent
            sex={sex}
            showPremium={showPremium}
            setShowPremium={setShowPremium}
            onHomeReady={onHomeReady}
          />
        </RestSessionProvider>
      </LoadProgressProvider>
    </PremiumActionProvider>
  );
}

function AppShellContent({
  sex,
  showPremium,
  setShowPremium,
  onHomeReady,
}: {
  sex: Sex;
  showPremium: boolean;
  setShowPremium: (value: boolean) => void;
  onHomeReady?: () => void;
}) {
  const { theme } = useTheme();
  useEffect(() => {
    recordPerfMark('appshell_mount');
  }, []);
  const { t, i18n } = useTranslation('workout');
  const reduceMotion = useReducedMotionPreference();
  const { tab, setTab } = useAppState();
  const { user, linkedProviders } = useAuth();
  const {
    prescription,
    loading: prescriptionLoading,
    generating: generatingWorkout,
    generate: generateWorkout,
    reload: reloadPrescription,
  } = useWorkoutPrescription();
  // `prescription.plan` is always the full `WorkoutProgramSnapshot` at
  // runtime here — `useWorkoutPrescription` only ever assigns it from
  // `loadActiveWorkoutProgram`/`generateAndPersistWorkoutProgram`, which
  // return the full snapshot, even though the type is widened to
  // `FinalWorkoutPlan` for the Prescription Engine's own contract.
  const activeProgram = prescription.status === 'SUCCESS'
    ? (prescription.plan as WorkoutProgramSnapshot)
    : null;
  const schedule = useWorkoutSchedule(activeProgram);
  const execution = useWorkoutExecution(activeProgram, schedule.config?.timezone, schedule.config?.scheduleMode);
  // Manual Substitution (exercise-substitution architecture audit): the same
  // declared-limitation-regions + equipment-context inputs the server-side
  // resolver uses, loaded once per active program so the "trocar" action can
  // compute a preview candidate list. Loading/error remain explicit UI states;
  // neither is allowed to hide the action or fabricate a default context.
  const [manualSubstitutionContextState, setManualSubstitutionContextState] = useState<{
    status: ManualSubstitutionContextStatus;
    context: ManualSubstitutionUserContext | null;
  }>({ status: 'loading', context: null });
  const [manualSubstitutionContextRetry, setManualSubstitutionContextRetry] = useState(0);
  const retryManualSubstitutionContext = useCallback(() => {
    setManualSubstitutionContextState({ status: 'loading', context: null });
    setManualSubstitutionContextRetry((current) => current + 1);
  }, []);
  useEffect(() => {
    if (!user || !activeProgram) {
      setManualSubstitutionContextState({ status: 'loading', context: null });
      return;
    }
    let cancelled = false;
    setManualSubstitutionContextState({ status: 'loading', context: null });
    loadManualSubstitutionUserContext(user.uid, activeProgram.environment, activeProgram.templateSourceVersion)
      .then((context) => {
        if (!cancelled) setManualSubstitutionContextState(
          context ? { status: 'ready', context } : { status: 'error', context: null },
        );
      })
      .catch(() => {
        if (!cancelled) setManualSubstitutionContextState({ status: 'error', context: null });
      });
    return () => { cancelled = true; };
  }, [user, activeProgram, manualSubstitutionContextRetry]);
  // Workout Recovery / Resume após process death — proactive, uid-scoped
  // bootstrap check for `workoutExecutionState/current`, independent of the
  // user ever tapping "Iniciar treino" (docs §4/§13).
  const recovery = useWorkoutSessionRecovery(user?.uid ?? null);
  const [recoveryAction, setRecoveryAction] = useState<'idle' | 'resuming' | 'finishing' | 'discarding'>('idle');
  const recoveryFinishInFlightRef = useRef(false);
  const [recoveryFinishError, setRecoveryFinishError] = useState(false);
  const [recoveryDiscardError, setRecoveryDiscardError] = useState(false);
  // Fase 5 — single canonical evolution view-model/actions for the whole
  // app (docs product §144/§146); reconciles once per AppShell mount.
  const evolution = useWorkoutEvolution(activeProgram?.programInstanceId ?? null);
  // Home's "esta semana"/"sua frequência" sections — same authoritative
  // trainingDays/activeRecoveryDays/timezone the Schedule Engine itself
  // resolved (`schedule.config`), never a second computation of them.
  const activatedAtLocalDate = (() => {
    const authoritativeActivatedAt = activeProgram?.programInstanceActivatedAt ?? activeProgram?.activatedAt;
    return authoritativeActivatedAt
      ? localDateInTimezone(authoritativeActivatedAt.toDate(), schedule.config?.timezone ?? deviceTimezone())
      : null;
  })();
  const activitySnapshot = useWorkoutActivitySnapshot({
    timezone: schedule.config?.timezone ?? deviceTimezone(),
    scheduleMode: schedule.config?.scheduleMode ?? activeProgram?.scheduleMode ?? 'fixed',
    prescribedTrainingFrequency: activeProgram?.prescribedTrainingFrequency ?? activeProgram?.prescribedStructuredDays,
    trainingDays: schedule.config?.trainingDays ?? [],
    activeRecoveryDays: schedule.config?.activeRecoveryDays ?? [],
    activatedAtLocalDate,
  });
  // "Sua frequência" — independently paginated (30-day blocks), same
  // canonical `workoutExecutions` completion source, own bounded/cached read.
  const frequencyWindow = useFrequencyWindow(schedule.config?.timezone ?? deviceTimezone());
  // Home Screen Widgets (Phase 2) — reuses the exact same resolved schedule
  // inputs as `activitySnapshot` above, but owns its own bounded completion
  // read (see `useWidgetSnapshotSync`'s doc comment for why `activitySnapshot`/
  // `frequencyWindow`'s already-loaded state isn't sufficient for streak).
  const widgetSnapshotSync = useWidgetSnapshotSync({
    timezone: schedule.config?.timezone ?? deviceTimezone(),
    sex,
    hasActiveProgram: activeProgram !== null,
    scheduleMode: schedule.config?.scheduleMode ?? activeProgram?.scheduleMode ?? 'fixed',
    prescribedTrainingFrequency: activeProgram?.prescribedTrainingFrequency ?? activeProgram?.prescribedStructuredDays,
    trainingDays: schedule.config?.trainingDays ?? [],
    activeRecoveryDays: schedule.config?.activeRecoveryDays ?? [],
    activatedAtLocalDate,
    sessions: activeProgram?.sessions ?? [],
    scheduleResolution: schedule.matchesActiveProgram ? schedule.resolution : null,
    programIdentity: activeProgram?.programInstanceId ?? activeProgram?.programId ?? null,
  });
  // Home-only streak read — deliberately separate from `widgetSnapshotSync`
  // above; reuses the same resolved schedule inputs but owns its own bounded
  // Firestore read (see `useHomeStreak`'s doc comment for why it can't reuse
  // `widgetSnapshotSync`'s already-loaded streak state).
  const homeStreak = useHomeStreak({
    timezone: schedule.config?.timezone ?? deviceTimezone(),
    hasActiveProgram: activeProgram !== null,
    scheduleMode: schedule.config?.scheduleMode ?? activeProgram?.scheduleMode ?? 'fixed',
    prescribedTrainingFrequency: activeProgram?.prescribedTrainingFrequency ?? activeProgram?.prescribedStructuredDays,
    trainingDays: schedule.config?.trainingDays ?? [],
    activeRecoveryDays: schedule.config?.activeRecoveryDays ?? [],
  });
  const { pendingIntent, consumeIntent } = useDeepLinkIntent();
  const {
    status: restStatus,
    rest: activeRest,
    beginWorkoutSession,
    endWorkoutSession,
  } = useRestSession();
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
  const [workoutInProgress, setWorkoutInProgress] = useState(false);
  const [workoutExecutionVisible, setWorkoutExecutionVisible] = useState(false);

  const beginPersistedWorkoutSession = (
    started: PersistedWorkoutExecution,
    sessionIndex: number,
  ) => {
    if (!activeProgram) return;
    const effectiveExerciseIds = new Map(
      started.exercises.map((exercise) => [exercise.exerciseIndex, exercise.exerciseId]),
    );
    const materializedExercises = workoutExercisesFromPlan(
      activeProgram,
      i18n.language,
      sessionIndex,
      effectiveExerciseIds,
    );
    const tLoose = t as unknown as LooseTranslate;
    const session = activeProgram.sessions[sessionIndex];
    const workoutName = session
      ? resolveSessionDisplayName(tLoose, session.name, session.type, session.displayName)
      : '';
    beginWorkoutSession({
      executionId: started.executionId,
      startedAt: started.startedAt.toMillis(),
      workoutName,
      exercises: started.exercises.map((exercise) => ({
        exerciseName: materializedExercises[exercise.exerciseIndex]?.name ?? exercise.exerciseId,
        settledSets: (() => {
          const firstPendingSet = exercise.sets.findIndex((set) => set.status === 'PENDING');
          return firstPendingSet === -1 ? exercise.sets.length : firstPendingSet;
        })(),
        totalSets: exercise.sets.length,
      })),
    });
  };
  // Visual-only optimistic entry state. The real WorkoutScreen is never
  // mounted from this flag; it merely owns the actionless preparing surface
  // while execution.start() acquires the durable Firestore mutex.
  const [workoutStartPending, setWorkoutStartPending] = useState(false);
  const [workoutStartAttempt, setWorkoutStartAttempt] = useState<{
    id: number;
    requestedAtMs: number;
    sessionIndex: number;
  } | null>(null);
  const workoutStartAttemptSequenceRef = useRef(0);
  const clearWorkoutStartAttempt = useCallback(() => setWorkoutStartAttempt(null), []);
  // React state does not update synchronously. This ref is the same-tick
  // re-entrancy guard that makes a double confirm a no-op before the first
  // `workoutStartPending` render has committed.
  const workoutStartInFlightRef = useRef(false);
  const lastWorkoutStartKindRef = useRef<'normal' | 'advanced'>('normal');
  const [startWorkoutError, setStartWorkoutError] = useState<WorkoutExecutionStartError | null>(null);
  const [resolvingPendingExecution, setResolvingPendingExecution] = useState(false);
  // The visual completion screen renders as soon as its last set is done,
  // before the durable Execution -> Schedule -> Lifecycle chain necessarily
  // finishes. Keep that chain available to the Done CTA so Profile can never
  // open with the previous IN_PROGRESS evaluation still cached.
  const workoutCompletionRef = useRef<Promise<WorkoutCompletionResult> | null>(null);
  const workoutFinalizationInputRef = useRef<{
    actualCardioDurationSeconds?: number;
    mode: WorkoutFinalizationMode;
  }>({ mode: 'NORMAL' });
  const workoutFinalizationProgressAttemptRef = useRef<WorkoutFinalizationProgressAttempt | null>(null);
  const appShellMountedRef = useRef(true);
  const [workoutFinalizationProgress, setWorkoutFinalizationProgress] =
    useState<WorkoutFinalizationProgressStage>('WAITING');
  const workoutCompletionFollowUpRef = useRef<Promise<unknown> | null>(null);
  const workoutHomeSyncRef = useRef<Promise<unknown> | null>(null);
  // True from the instant `onSessionCompleted` fires until the durable
  // atomic finalizer settles (lifecycle remains a later follow-up) — drives
  // the "Finalizando treino..." state so the
  // success screen never lets the user believe (or navigate away on) an
  // unconfirmed completion (docs — Cardio Finisher Completion Recovery
  // hardening). Deliberately separate from `workoutCompletionRef` (a plain
  // ref, not observable by React) even though they're set/cleared together.
  const [finishingSession, setFinishingSession] = useState(false);
  const [workoutCompletionResult, setWorkoutCompletionResult] = useState<WorkoutCompletionResult | null>(null);
  // Deliberately NOT cleared when a new attempt starts (only when its outcome
  // is known) — while `finishingSession` is true, a still-set category from
  // the previous attempt is exactly what tells the UI "this is a retry, not
  // the first try" without any extra plumbing.
  const [workoutCompletionFailureCategory, setWorkoutCompletionFailureCategory] =
    useState<WorkoutFinalizationErrorCategory | null>(null);
  const [durableCompletionReachedAtMs, setDurableCompletionReachedAtMs] = useState<number | null>(null);

  const advanceWorkoutFinalizationProgress = useCallback((stage: WorkoutFinalizationProgressStage) => {
    setWorkoutFinalizationProgress((current) => furthestWorkoutFinalizationStage(current, stage));
  }, []);

  useEffect(() => {
    appShellMountedRef.current = true;
    return () => {
      appShellMountedRef.current = false;
      workoutFinalizationProgressAttemptRef.current?.dispose();
      workoutFinalizationProgressAttemptRef.current = null;
    };
  }, []);
  // Re-entrancy guard for `finishWorkoutSession` — the composer's "Back to
  // home" CTA is already disabled while `finishingSession`/awaiting, but this closes the
  // same-tick gap between a tap and that state committing.
  const finishSessionInFlightRef = useRef(false);
  const { isPremium } = useSubscription();
  const paywallPremiumReturnState = useRef(INITIAL_PAYWALL_PREMIUM_RETURN_STATE);
  // Single centralized prewarm schedule (docs/23_navegacao_e_lifecycle.md
  // §8/§14) — PREWARM_ROUTE_IDS in src/lib/prewarmRoutes.ts is the only
  // place route order/membership is declared; nothing here chains
  // `usePrewarm` calls by hand anymore.
  const prewarmed = usePrewarmQueue();
  const [showAssessment, setShowAssessment] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showMyPlan, setShowMyPlan] = useState(false);
  const [showSubscriptionCenter, setShowSubscriptionCenter] = useState(false);
  // Single state machine for the whole "iniciar treino" flow — the Missed
  // Session decision (when a decision is pending) and the Start
  // confirmation are two steps of ONE flow, never two independently-toggled
  // booleans. That construction makes MissedSessionDecisionModal and
  // StartWorkoutConfirmation structurally unable to both be `visible` at
  // once (previously possible: `showWorkoutConfirmation` had no relation to
  // the Schedule Engine's resolution status, so a tap on the Workout tab
  // while a miss decision was showing could mount a second native `Modal`
  // on top of it — a documented cause of a stuck/unresponsive overlay).
  const [startWorkoutFlow, setStartWorkoutFlow] = useState<'idle' | 'missedDecision' | 'confirmation'>('idle');
  const [showAdvanceWorkoutConfirmation, setShowAdvanceWorkoutConfirmation] = useState(false);
  const [agendaEditorOpen, setAgendaEditorOpen] = useState(false);
  const [missedDecisionPending, setMissedDecisionPending] = useState<MissDecision | null>(null);
  const [missedDecisionError, setMissedDecisionError] = useState(false);
  const [missedDecisionContext, setMissedDecisionContext] = useState<MissedSessionDecisionIdentity | null>(null);
  const missDecisionTapInFlightRef = useRef(false);
  const [showEvolutionUnlock, setShowEvolutionUnlock] = useState(false);
  const [supportRoute, setSupportRoute] = useState<SupportRoute | null>(null);
  // Realtime, Firestore-backed unread count for the Home support icon's
  // badge (see useUnreadSupportCasesCount) — no locally tracked counter.
  const unreadSupportCases = useUnreadSupportCasesCount(user?.uid);
  const [homePresentationSnapshot, setHomePresentationSnapshot] = useState<HomePresentationSnapshot | null>(null);
  const [snapshotVisualReady, setSnapshotVisualReady] = useState(false);
  const snapshotFrameRef = useRef<number | null>(null);
  const snapshotLayoutRef = useRef(false);
  const snapshotOverlayMarkRef = useRef(false);
  const authoritativeReadyMarkRef = useRef(false);
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    recordPerfMark('home_snapshot_read_start');
    void readHomePresentationSnapshot(uid).then((snapshot) => {
      if (cancelled) return;
      if (!snapshot || !projectCachedFrequency(snapshot, new Date())) {
        recordPerfMark('home_snapshot_miss');
        return;
      }
      recordPerfMark('home_snapshot_hit');
      setHomePresentationSnapshot(snapshot);
      recordPerfMark('home_snapshot_applied');
    });
    return () => {
      cancelled = true;
      if (snapshotFrameRef.current !== null) cancelAnimationFrame(snapshotFrameRef.current);
    };
  }, [user?.uid]);
  const homeInitialReadiness = deriveHomeInitialReadiness({
    prescriptionLoading,
    generatingWorkout,
    prescriptionStatus: prescription.status,
    scheduleLoading: schedule.loading || !schedule.matchesActiveProgram,
    scheduleStatus: schedule.resolution.status,
    scheduleRefreshFailed: schedule.refreshError !== null,
    evolutionKind: evolution.viewModel.kind,
    evolutionNoticeUnavailable: evolution.viewModel.kind === 'SUMMARY_READY'
      && Boolean(evolution.viewModel.noticeUnavailable),
    activityStatus: activitySnapshot.initialStatus,
    weekOverviewAvailable: activitySnapshot.week !== null,
    frequencyStatus: frequencyWindow.initialStatus,
    frequencyWindowAvailable: frequencyWindow.viewModel !== null,
    frequencyLoading: frequencyWindow.loading,
    supportInboxStatus: unreadSupportCases.initialStatus,
  });
  const {
    homeInitialDataSettled,
    homeInitialVisualReady,
    onInitialLayoutCommitted,
  } = useHomeInitialVisualReady(homeInitialReadiness.allRequiredDataSettled);
  const cachedFrequency = homePresentationSnapshot && homePresentationSnapshot.uid === user?.uid
    ? projectCachedFrequency(homePresentationSnapshot, new Date()) : null;
  const snapshotPathAvailable = Boolean(cachedFrequency && !homeInitialVisualReady);
  const onSnapshotLayoutCommitted = useCallback(() => {
    if (!snapshotPathAvailable || snapshotLayoutRef.current || snapshotVisualReady) return;
    snapshotLayoutRef.current = true;
    recordPerfMark('home_snapshot_layout_committed');
    snapshotFrameRef.current = requestAnimationFrame(() => {
      snapshotFrameRef.current = null;
      recordPerfMark('home_snapshot_visual_ready');
      setSnapshotVisualReady(true);
    });
  }, [snapshotPathAvailable, snapshotVisualReady]);
  const homeVisible = homeInitialVisualReady || snapshotVisualReady;
  // Deliberately NOT the same as `homeVisible`. `homeVisible` ORs in the
  // cached-snapshot fast path — legitimate for making the Home content tree
  // interactive/accessible quickly, but a stale/partial snapshot still
  // shows visible "still updating" copy (today's card, frequency) until the
  // authoritative read lands. The root splash (see App.tsx/WordmarkSplash)
  // must wait for that authoritative terminal state — success, empty, or a
  // handled error, never a mid-refresh snapshot — so it never uncovers a
  // Home that is about to visibly change under the user.
  const homeInitialRevealReady = homeInitialVisualReady;
  // Reports readiness up to the single root splash — never from the
  // snapshot-satisfied `homeVisible` alone. `onHomeReady` is optional and a
  // no-op once the process's cold start is already done (see App.tsx); the
  // caller-side latch is what makes repeat calls (e.g. after a later
  // logout/login) harmless.
  useEffect(() => {
    if (homeInitialRevealReady) onHomeReady?.();
  }, [homeInitialRevealReady, onHomeReady]);
  useEffect(() => {
    if (snapshotVisualReady && !homeInitialVisualReady && !snapshotOverlayMarkRef.current) {
      snapshotOverlayMarkRef.current = true;
      recordPerfMark('home_snapshot_overlay_hidden');
    }
  }, [snapshotVisualReady, homeInitialVisualReady]);
  const authoritativeHomeValid = canWriteHomePresentationSnapshot({
    uid: user?.uid ?? null,
    programInstanceId: activeProgram?.programInstanceId ?? null,
    timezone: schedule.config?.timezone ?? null,
    readiness: homeInitialReadiness,
    activityLoading: activitySnapshot.loading,
    frequencyLoading: frequencyWindow.loading,
    frequency: frequencyWindow.viewModel,
  });
  const snapshotPresentationActive = shouldUseSnapshotPlaceholders({
    snapshotAvailable: Boolean(cachedFrequency),
    authoritativeNow: authoritativeHomeValid,
    authoritativeReachedOnce: authoritativeReadyMarkRef.current,
  });
  const frequencyPresentation = chooseHomeFrequencyPresentation({
    current: frequencyWindow.viewModel,
    currentReadSucceeded: frequencyWindow.initialStatus === 'SUCCESS',
    cached: cachedFrequency,
  });
  useEffect(() => {
    if (homeInitialReadiness.allRequiredDataSettled) recordPerfMark('home_authoritative_data_settled');
  }, [homeInitialReadiness.allRequiredDataSettled]);
  useEffect(() => {
    if (homeInitialVisualReady && authoritativeHomeValid && !authoritativeReadyMarkRef.current) {
      authoritativeReadyMarkRef.current = true;
      recordPerfMark('home_authoritative_ready');
    }
  }, [homeInitialVisualReady, authoritativeHomeValid]);
  useEffect(() => {
    if (!user?.uid || !homeInitialVisualReady || !authoritativeHomeValid ||
        !frequencyWindow.viewModel || !schedule.config?.timezone) return;
    void writeHomePresentationSnapshot({
      uid: user.uid,
      timezone: schedule.config.timezone,
      frequency: frequencyWindow.viewModel,
    });
  }, [user?.uid, homeInitialVisualReady, authoritativeHomeValid, frequencyWindow.viewModel, schedule.config?.timezone]);
  useEffect(() => {
    setForegroundSupportCaseId(supportRoute?.name === 'case' ? supportRoute.caseId : null);
    return () => setForegroundSupportCaseId(null);
  }, [supportRoute]);
  // HelpArticleScreen/SupportFormScreen are persistent+materialized but
  // can't be prewarmed with no real data (docs/23_navegacao_e_lifecycle.md
  // §14, "Suporte") — they need a valid `article`/`type` prop even while
  // `inactive`, so the last one the user actually opened is latched here
  // instead of read straight off `supportRoute` (which goes back to 'help'
  // or null the moment the user navigates away).
  const [lastArticle, setLastArticle] = useState<HelpArticle | null>(null);
  const [lastFormRoute, setLastFormRoute] = useState<{
    type: SupportTicketType;
    subject?: string;
  }>({ type: 'SUPPORT' });
  const canChangePassword = linkedProviders.includes(PASSWORD_PROVIDER_ID);
  // Workout Recovery has precedence over every other start-workout surface
  // (docs §14) — while it's open, `requestStartWorkout` bails out to it
  // instead of ever reaching the Missed Session decision, and `overlayOpen`
  // keeps every other modal (evolution unlock, on-demand paywall, etc.) from
  // opening on top of it.
  const recoveryModalOpen = recovery.state.status === 'pending' || recovery.state.status === 'inconsistent';
  const advanceTarget = activeProgram && schedule.config
    ? advancedWorkoutTarget({
        scheduleMode: schedule.config?.scheduleMode ?? activeProgram.scheduleMode ?? 'fixed',
        resolution: schedule.resolution,
        todayLocalDate: localDateInTimezone(new Date(), schedule.config.timezone),
        sessionCount: activeProgram.sessions.length,
        hasIncompatibleExecution: workoutInProgress
          || workoutStartPending
          || execution.starting
          || recovery.state.status !== 'none',
      })
    : null;
  const overlayOpen =
    showAssessment ||
    showSettings ||
    showSecurity ||
    showNotificationSettings ||
    showAccountSettings ||
    showChangePassword ||
    showEditProfile ||
    showMyPlan ||
    showSubscriptionCenter ||
    showDeleteAccount ||
    showPremium ||
    startWorkoutFlow !== 'idle' ||
    showAdvanceWorkoutConfirmation ||
    !!startWorkoutError ||
    !!supportRoute ||
    recoveryModalOpen;
  useEffect(() => {
    if (showAdvanceWorkoutConfirmation && !advanceTarget) setShowAdvanceWorkoutConfirmation(false);
  }, [advanceTarget, showAdvanceWorkoutConfirmation]);
  useEffect(() => {
    if (!canChangePassword) setShowChangePassword(false);
  }, [canChangePassword]);

  // Explain a persisted AUTO activation at the next safe app surface. Never
  // interrupt a live workout, a confirmation, or another overlay —
  // `overlayOpen` already covers the whole start-workout flow (miss
  // decision + confirmation), so a single check here is enough to keep this
  // Modal from ever coexisting with either of those.
  useEffect(() => {
    if (
      evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE'
      && homeInitialVisualReady
      && tab !== 'workout'
      && !overlayOpen
    ) {
      // Hydrate the ProgramInstance that the persisted event says is active,
      // but only after leaving the live Workout surface.
      void reloadPrescription();
      setShowEvolutionUnlock(true);
    }
  }, [evolution.viewModel.kind, homeInitialVisualReady, overlayOpen, reloadPrescription, tab]);

  // The root Paywall is closed by resolvePremiumGate, but this on-demand
  // Paywall is an AppShell overlay. Close that overlay only after the same
  // RevenueCat-backed source of truth has actually transitioned false -> true
  // while it is open. Clearing showPremium reveals the already-mounted screen
  // underneath; no route reconstruction or fixed destination is involved.
  useEffect(() => {
    const transition = resolvePaywallPremiumReturn(paywallPremiumReturnState.current, {
      visible: showPremium,
      isPremium,
    });
    paywallPremiumReturnState.current = transition.state;
    if (transition.shouldClose) setShowPremium(false);
  }, [isPremium, setShowPremium, showPremium]);

  // Single real entry point into starting/resuming a workout (docs
  // §Bloqueio real) — TabBar, Home's card, the deep-link intent effect and
  // WorkoutRestHeaderStatus all funnel through this instead of setting
  // `startWorkoutFlow` directly, so there is exactly one place that decides
  // whether the flow opens on MISSED_SESSION_DECISION_REQUIRED first. The
  // Schedule Engine resolution — not this function — is still what actually
  // gates `execution.start` inside `startWorkout` below; this only decides
  // which overlay step to show first.
  const requestStartWorkout = useCallback(() => {
    if (workoutStartInFlightRef.current || workoutStartPending) return;
    if (workoutInProgress) {
      setWorkoutExecutionVisible(true);
      setTab('workout');
      return;
    }
    // Workout Recovery precedence (docs §14): a pending/inconsistent
    // recovery pointer must be resolved (Continuar/Descartar) before any
    // other start-workout decision — including Missed Session — is ever
    // shown. The recovery modal is already rendered independent of this
    // function (proactively, at bootstrap); this just stops a tap from
    // opening a second, contradictory overlay on top of it.
    if (recoveryModalOpen) return;
    if (schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {
      setMissedDecisionError(false);
      setMissedDecisionContext(missedDecisionIdentity(schedule.resolution));
      setStartWorkoutFlow('missedDecision');
      return;
    }
    setStartWorkoutFlow('confirmation');
  }, [workoutInProgress, workoutStartPending, recoveryModalOpen, schedule.resolution, setTab]);

  /** Separate intent for V1's one-day fixed-schedule exception. */
  const requestAdvanceWorkout = useCallback(() => {
    if (!advanceTarget || workoutStartInFlightRef.current || overlayOpen) return;
    setShowAdvanceWorkoutConfirmation(true);
  }, [advanceTarget, overlayOpen]);

  // TREINO Nav Bar tab now navigates to the hub screen instead of
  // immediately opening the start-workout confirmation (docs §Nova tela
  // TREINO) — starting a workout is still reached through the SAME single
  // entry point (`requestStartWorkout`), just from the hub's own CTA instead
  // of from the tab tap itself.
  const selectTab = (nextTab: TabId) => {
    if (nextTab === 'workout' && workoutInProgress) setWorkoutExecutionVisible(false);
    setTab(nextTab);
  };

  /**
   * Manual sequence reposition (docs §Escolha manual de treino). The Schedule
   * Engine's own already-resolved `resolution` is the only source for "where
   * the rotation currently is" — never recomputed a second way here.
   */
  const requestReposition = useCallback(async (targetSessionIndex: number): Promise<RepositionOutcome> => {
    if (!user || !activeProgram || !schedule.config) return 'ERROR';
    if (workoutInProgress || workoutStartPending || execution.starting) return 'BLOCKED_IN_PROGRESS';
    const expectedCurrentNextSessionIndex = effectiveNextSessionIndex(schedule.resolution);
    if (expectedCurrentNextSessionIndex === null) return 'ERROR';
    try {
      await repositionScheduleCursor({
        uid: user.uid,
        programId: activeProgram.programId,
        programInstanceId: activeProgram.programInstanceId,
        sessionCount: activeProgram.sessions.length,
        scheduleMode: schedule.config.scheduleMode ?? 'fixed',
        targetSessionIndex,
        todayLocalDate: localDateInTimezone(new Date(), schedule.config.timezone),
        expectedCurrentNextSessionIndex,
      });
      await schedule.reload();
      return 'OK';
    } catch (error) {
      const code = errorCode(error);
      const reason = errorReason(error);
      logWarn('workout_schedule', 'reposition_schedule_cursor_failed', {
        errorCode: code,
        errorReason: reason,
        errorClass: errorClass(error),
        targetSessionIndex,
        expectedCurrentNextSessionIndex,
        sessionCount: activeProgram.sessions.length,
        scheduleMode: schedule.config.scheduleMode ?? 'fixed',
        scheduledLocalDate: localDateInTimezone(new Date(), schedule.config.timezone),
        hasProgramInstanceId: Boolean(activeProgram.programInstanceId),
      });
      if (reason === 'reposition_target_already_completed_today') return 'ALREADY_COMPLETED_TODAY';
      if (reason === 'reposition_blocked_by_in_progress_execution') return 'BLOCKED_IN_PROGRESS';
      return 'ERROR';
    }
  }, [user, activeProgram, schedule, workoutInProgress, workoutStartPending, execution.starting]);

  /** Same N days -> other N days, or fixed <-> flexible with no frequency change (docs §Alteração de agenda). Never touches the program. */
  const handleSaveAgenda = useCallback(async (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[] }): Promise<AgendaSaveOutcome> => {
    if (!user || !schedule.config) return 'ERROR';
    if (workoutInProgress || workoutStartPending || execution.starting) return 'ERROR';
    try {
      // Decision #5 precedent (resolving a pending miss never requires the
      // user to answer "recover or skip" first): switching modes while a
      // miss decision is pending must not leave it orphaned either — resolve
      // it as CONTINUE_SEQUENCE (preserves adherence, never SKIPPED) before
      // the mode that can no longer see it (`flexible`) takes over.
      if (schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED') {
        const identity = missedDecisionIdentity(schedule.resolution);
        if (identity) {
          const outcome = await schedule.resolveMiss('CONTINUE_SEQUENCE', identity);
          if (outcome.status === 'FAILED') return 'ERROR';
        }
      }
      await saveScheduleConfig(user.uid, {
        scheduleMode: value.scheduleMode,
        trainingDays: value.trainingDays,
        timezone: schedule.config.timezone,
      });
      await schedule.reload();
      return 'OK';
    } catch (error) {
      logWarn('workout_schedule', 'save_schedule_config_failed', { errorCode: errorCode(error), errorClass: errorClass(error) });
      return 'ERROR';
    }
  }, [user, schedule, workoutInProgress, workoutStartPending, execution.starting]);

  /** Frequency actually changed (docs §Alteração de frequência) — the authoritative ADAPT trail, never a manual template swap. */
  const handleChangeFrequency = useCallback(async (value: { scheduleMode: ScheduleMode; trainingDays: Weekday[]; days: number }): Promise<AgendaSaveOutcome> => {
    if (!user || !activeProgram) return 'ERROR';
    if (workoutInProgress || workoutStartPending || execution.starting) return 'ERROR';
    try {
      const idempotencyKey = `agenda-frequency:${activeProgram.programInstanceId ?? activeProgram.programId}:${value.scheduleMode}:${value.days}:${[...value.trainingDays].sort().join('-')}`;
      const result = await adaptWorkoutProgram({
        uid: user.uid,
        updatedFields: { days: value.days, scheduleMode: value.scheduleMode, trainingDays: value.scheduleMode === 'fixed' ? value.trainingDays : null },
        reason: 'AVAILABILITY',
        idempotencyKey,
      });
      if (result.status !== 'SUCCESS') return 'ERROR';
      // ScheduleConfig is reconciled inside ADAPT before success returns.
      // Reload the prescription first; useWorkoutSchedule's program-scoped
      // effect then resolves the new instance, avoiding an eager reload that
      // still closes over the superseded program.
      await reloadPrescription();
      return 'OK';
    } catch (error) {
      logWarn('workout_lifecycle', 'adapt_workout_program_frequency_failed', {
        errorCode: errorCode(error), errorClass: errorClass(error), errorReason: errorReason(error),
      });
      return 'ERROR';
    }
  }, [user, activeProgram, reloadPrescription, workoutInProgress, workoutStartPending, execution.starting]);

  useEffect(() => {
    // RootNavigator and the workout-readiness gate have already resolved by
    // the time AppShell mounts. Native taps still reuse the canonical start
    // confirmation and Schedule Engine decision; a deep link never creates
    // or materializes a workout session on its own.
    if (!pendingIntent || showEvolutionUnlock) return;

    if (pendingIntent.type === 'active-workout') {
      if (overlayOpen) return;
      if (tab !== 'workout' && startWorkoutFlow === 'idle') {
        requestStartWorkout();
      }
      consumeIntent(pendingIntent);
    } else if (pendingIntent.type === 'support-case') {
      setSupportRoute({ name: 'case', caseId: pendingIntent.caseId, casesOrigin: 'home' });
      consumeIntent(pendingIntent);
    }
  }, [
    consumeIntent,
    overlayOpen,
    pendingIntent,
    requestStartWorkout,
    showEvolutionUnlock,
    startWorkoutFlow,
    setTab,
    tab,
    workoutInProgress,
  ]);

  const handleMissDecision = async (decision: MissDecision) => {
    if (missDecisionTapInFlightRef.current || missedDecisionPending || schedule.loading) return;
    if (!missedDecisionContext) return;
    missDecisionTapInFlightRef.current = true;
    const expected = missedDecisionContext;
    setMissedDecisionError(false);
    setMissedDecisionPending(decision);
    try {
      const outcome = await schedule.resolveMiss(decision, expected);
      const currentDecision = outcome.resolution
        ? missedDecisionIdentity(outcome.resolution)
        : null;
      if (currentDecision && !sameMissedDecision(expected, currentDecision)) {
        // The old choice was scoped to `expected`; keep the modal on the new
        // canonical decision without ever applying that choice to it.
        setMissedDecisionContext(currentDecision);
        setMissedDecisionError(false);
        setStartWorkoutFlow('missedDecision');
      } else if (outcome.status === 'FAILED') {
        // A real transport/backend failure, or the server still reporting
        // the exact same decision after rejecting it, remains retryable.
        setMissedDecisionError(true);
      } else if (outcome.resolution.status === 'SESSION_READY') {
        setMissedDecisionContext(null);
        setStartWorkoutFlow('confirmation');
      } else {
        setMissedDecisionContext(null);
        setStartWorkoutFlow('idle');
      }
    } finally {
      missDecisionTapInFlightRef.current = false;
      setMissedDecisionPending(null);
    }
  };

  // A foreground/completion reload may invalidate the displayed decision
  // before the user taps. Reconcile the open modal as soon as the newest
  // server-authoritative projection publishes; do not leave a stale modal
  // interactive between reload completion and the next start attempt.
  useEffect(() => {
    if (startWorkoutFlow !== 'missedDecision' || missedDecisionPending) return;
    const currentDecision = missedDecisionIdentity(schedule.resolution);
    if (sameMissedDecision(missedDecisionContext, currentDecision)) return;
    setMissedDecisionError(false);
    if (currentDecision) {
      setMissedDecisionContext(currentDecision);
    } else {
      setMissedDecisionContext(null);
      setStartWorkoutFlow(schedule.resolution.status === 'SESSION_READY' ? 'confirmation' : 'idle');
    }
  }, [missedDecisionContext, missedDecisionPending, schedule.resolution, startWorkoutFlow]);

  // Backdrop-tap dismissal only — there is no "not now" button, and this
  // never resolves/skips the pending decision. It just returns to idle;
  // `pendingMissDecision` is untouched, so the next "Iniciar treino" tap
  // reopens the same modal.
  const cancelMissDecision = () => {
    if (missedDecisionPending) return;
    setMissedDecisionError(false);
    setMissedDecisionContext(null);
    setStartWorkoutFlow('idle');
  };

  // FASE 3→5 (docs/13_assinaturas_e_billing.md): START_WORKOUT is a Premium
  // capability. `selectTab` below always routes a tap on the Workout icon
  // through the same confirmation flow, so this is the single real entry
  // point into the Workout tab — `<PremiumAction>` inside
  // `StartWorkoutConfirmation` gates it (Fase 5), meaning this function
  // itself now knows nothing about capabilities: it only runs at all when
  // already allowed. REGISTER_WORKOUT/REGISTER_LOAD/"registrar série" have
  // no independent entry point today — they only exist once inside the
  // session this call opens — so that same gate is also what protects them
  // (see Fase 3 report, "Decisão sobre REGISTER_SET").
  // P0 integrity fix (2026-09, docs/workout-lifecycle/ — production
  // incident: `workoutInProgress` (this component's own local state) used to
  // flip to `true`, and `WorkoutScreen` mount synchronously, BEFORE
  // `execution.start()` — the actual persisted, authoritative start —
  // resolved (it was fired with `void`, fully decoupled from this
  // function's control flow). If that persisted start failed (offline, a
  // conflict, a legacy pending execution), the user still landed on a live
  // WorkoutScreen with no durable execution behind it — a "phantom" session
  // (docs §9). `startWorkout` is now async and strictly sequential: an inert
  // Preparing surface may appear immediately, but the authoritative start
  // must SUCCEED before the mutable WorkoutScreen can mount.
  const startWorkout = async () => {
    if (prescription.status !== 'SUCCESS') {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        logInfo('workout_performance', 'start_workout_guard_exit', {
          reason: 'PRESCRIPTION_NOT_READY',
          prescriptionStatus: prescription.status,
          scheduleStatus: schedule.resolution.status,
          scheduleLoading: schedule.loading,
          workoutStartPending,
          hasAppShellActiveAttempt: workoutStartInFlightRef.current,
        });
      }
      return;
    }
    // BLOQUEIO REAL (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Bloqueio
    // real): the Schedule Engine resolution — not this button, not whatever
    // tab the user happened to land on — is what decides whether a session
    // may start. Only SESSION_READY ever calls `execution.start`; REST_DAY,
    // TODAY_COMPLETED, SCHEDULE_SETUP_REQUIRED, PROGRAM_NOT_AVAILABLE and a
    // pending miss decision all fall through to the Workout tab's own
    // blocked-state render below instead of a live session — a stale
    // confirmation, a deep link or a re-tap can reach this function in any
    // of those states and still can never open a second session for a day
    // already resolved (idempotent otherwise: a double tap or a cold-start
    // reopen resumes the same execution, docs §22-25).
    if (schedule.resolution.status !== 'SESSION_READY') {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        logInfo('workout_performance', 'start_workout_guard_exit', {
          reason: 'SCHEDULE_NOT_READY',
          prescriptionStatus: prescription.status,
          scheduleStatus: schedule.resolution.status,
          scheduleLoading: schedule.loading,
          workoutStartPending,
          hasAppShellActiveAttempt: workoutStartInFlightRef.current,
        });
      }
      return;
    }
    if (workoutStartInFlightRef.current) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        logInfo('workout_performance', 'start_workout_guard_exit', {
          reason: 'ATTEMPT_ACTIVE',
          prescriptionStatus: prescription.status,
          scheduleStatus: schedule.resolution.status,
          scheduleLoading: schedule.loading,
          workoutStartPending,
          hasAppShellActiveAttempt: workoutStartInFlightRef.current,
        });
      }
      return;
    }
    lastWorkoutStartKindRef.current = 'normal';
    workoutStartInFlightRef.current = true;
    const requestedAtMs = Date.now();
    const sessionIndex = schedule.resolution.sessionIndex;
    const attemptId = ++workoutStartAttemptSequenceRef.current;
    logInfo('workout_execution', 'start_user_confirmed', { attemptId, sessionIndex });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      logInfo('workout_performance', 'start_workout_confirmed', {
        timestampMs: requestedAtMs,
        attemptId,
        sessionIndex,
      });
    }
    workoutCompletionRef.current = null;
    workoutHomeSyncRef.current = null;
    setWorkoutCompletionResult(null);
    setWorkoutCompletionFailureCategory(null);
    setDurableCompletionReachedAtMs(null);
    setFinishingSession(false);
    setStartWorkoutFlow('idle');
    setStartWorkoutError(null);
    setActiveSessionIndex(sessionIndex);
    setWorkoutStartAttempt({ id: attemptId, requestedAtMs, sessionIndex });
    setWorkoutStartPending(true);
    setWorkoutExecutionVisible(true);
    // Navigation is deliberately before the first await. Only the inert
    // preparing surface can render until the authoritative start succeeds.
    setTab('workout');
    try {
      const { execution: started, error } = await execution.start(sessionIndex, {
        manualSubstitutionContext: manualSubstitutionContextState.context,
        manualSubstitutionContextStatus: manualSubstitutionContextState.status,
      });
      const durationMs = Date.now() - requestedAtMs;
      if (!started) {
        // Roll back the optimistic surface atomically. Since WorkoutScreen
        // never mounted, there is no local set/rest/finish state to unwind.
        setWorkoutStartPending(false);
        setWorkoutInProgress(false);
        setWorkoutExecutionVisible(false);
        setWorkoutStartAttempt(null);
        setTab('home');
        setStartWorkoutError(error);
        logWarn('workout_execution', 'start_ui_rolled_back', {
          attemptId,
          sessionIndex,
          durationMs,
          errorCode: error.code,
        });
        return;
      }
      // Persisted start succeeded. This single render swaps the preparing
      // surface for WorkoutScreen in place, without another navigation.
      setWorkoutInProgress(true);
      setWorkoutStartPending(false);
      beginPersistedWorkoutSession(started, sessionIndex);
      void widgetSnapshotSync.resyncNow();
      logInfo('workout_execution', 'start_ui_confirmed', { attemptId, sessionIndex, durationMs });
    } catch (error) {
      // useWorkoutExecution currently converts failures to typed results;
      // this boundary keeps a future unexpected throw from stranding the UI.
      setWorkoutStartPending(false);
      setWorkoutInProgress(false);
      setWorkoutExecutionVisible(false);
      setWorkoutStartAttempt(null);
      setTab('home');
      setStartWorkoutError({ code: 'UNKNOWN' });
      logWarn('workout_execution', 'start_ui_rolled_back', {
        attemptId,
        sessionIndex,
        durationMs: Date.now() - requestedAtMs,
        error,
      });
    } finally {
      workoutStartInFlightRef.current = false;
    }
  };

  /**
   * Explicit V1 advance path. It re-derives the target immediately before
   * persistence and never weakens `startWorkout`'s SESSION_READY gate.
   */
  const startAdvancedWorkout = async () => {
    if (prescription.status !== 'SUCCESS' || !activeProgram || !schedule.config) return;
    const target = advancedWorkoutTarget({
      scheduleMode: schedule.config?.scheduleMode ?? activeProgram.scheduleMode ?? 'fixed',
      resolution: schedule.resolution,
      todayLocalDate: localDateInTimezone(new Date(), schedule.config.timezone),
      sessionCount: activeProgram.sessions.length,
      hasIncompatibleExecution: workoutInProgress
        || workoutStartPending
        || execution.starting
        || recovery.state.status !== 'none',
    });
    if (!target || workoutStartInFlightRef.current) return;

    lastWorkoutStartKindRef.current = 'advanced';
    workoutStartInFlightRef.current = true;
    const requestedAtMs = Date.now();
    const { sessionIndex } = target;
    const attemptId = ++workoutStartAttemptSequenceRef.current;
    logInfo('workout_execution', 'advanced_start_user_confirmed', { attemptId, sessionIndex });
    workoutCompletionRef.current = null;
    workoutHomeSyncRef.current = null;
    setWorkoutCompletionResult(null);
    setWorkoutCompletionFailureCategory(null);
    setDurableCompletionReachedAtMs(null);
    setFinishingSession(false);
    setShowAdvanceWorkoutConfirmation(false);
    setStartWorkoutError(null);
    setActiveSessionIndex(sessionIndex);
    setWorkoutStartAttempt({ id: attemptId, requestedAtMs, sessionIndex });
    setWorkoutStartPending(true);
    setWorkoutExecutionVisible(true);
    setTab('workout');
    try {
      const { execution: started, error } = await execution.startAdvanced(schedule.resolution);
      const durationMs = Date.now() - requestedAtMs;
      if (!started) {
        setWorkoutStartPending(false);
        setWorkoutInProgress(false);
        setWorkoutExecutionVisible(false);
        setWorkoutStartAttempt(null);
        setTab('home');
        setStartWorkoutError(error);
        logWarn('workout_execution', 'advanced_start_ui_rolled_back', {
          attemptId, sessionIndex, durationMs, errorCode: error.code,
        });
        return;
      }
      setWorkoutInProgress(true);
      setWorkoutStartPending(false);
      beginPersistedWorkoutSession(started, sessionIndex);
      void widgetSnapshotSync.resyncNow();
      logInfo('workout_execution', 'advanced_start_ui_confirmed', { attemptId, sessionIndex, durationMs });
    } catch (error) {
      setWorkoutStartPending(false);
      setWorkoutInProgress(false);
      setWorkoutExecutionVisible(false);
      setWorkoutStartAttempt(null);
      setTab('home');
      setStartWorkoutError({ code: 'UNKNOWN' });
      logWarn('workout_execution', 'advanced_start_ui_rolled_back', {
        attemptId, sessionIndex, durationMs: Date.now() - requestedAtMs, error,
      });
    } finally {
      workoutStartInFlightRef.current = false;
    }
  };

  /** Resolves a CONFLICT/LEGACY_PENDING `startWorkoutError` by abandoning the offending pending execution, then retries `startWorkout` (docs §11/§12). Never offers "resume" — see `WorkoutExecutionPendingModal`'s doc comment. */
  const resolvePendingExecutionAndRetry = async (executionId: string) => {
    setResolvingPendingExecution(true);
    try {
      await execution.abandonExecutionById(executionId);
      void widgetSnapshotSync.resyncNow();
      setStartWorkoutError(null);
      if (lastWorkoutStartKindRef.current === 'advanced') await startAdvancedWorkout();
      else await startWorkout();
    } catch (error) {
      logWarn('workout_execution', 'pending_execution_resolution_failed', { error });
    } finally {
      setResolvingPendingExecution(false);
    }
  };

  // Workout Recovery / Resume após process death. `recoveryCanResume` gates
  // the modal's "Continuar" action to a pending session whose program still
  // matches the account's currently active one — a program that changed
  // since the session started could never be safely rendered by
  // WorkoutScreen (wrong exercises/prescriptions), only discarded.
  const recoveryCanResume = recovery.state.status === 'pending' && !!activeProgram
    && (recovery.state.execution.programInstanceId ?? recovery.state.execution.programId)
      === (activeProgram.programInstanceId ?? activeProgram.programId);
  const recoveryExecution = recovery.state.status === 'pending' || recovery.state.status === 'inconsistent'
    ? recovery.state.execution
    : null;
  const recoveryCanFinalize = !!recoveryExecution && !!activeProgram
    && ['IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(recoveryExecution.status)
    && (recoveryExecution.programInstanceId ?? recoveryExecution.programId)
      === (activeProgram.programInstanceId ?? activeProgram.programId);

  const handleResumeRecovery = async () => {
    if (recovery.state.status !== 'pending' || recoveryAction !== 'idle' || !user) return;
    setRecoveryAction('resuming');
    setRecoveryFinishError(false);
    setRecoveryDiscardError(false);
    try {
      // Re-validate freshness immediately before acting — another device
      // could have finished or discarded this exact session while the modal
      // was open (docs §12). A stale view here must never hydrate a dead
      // session; just re-run the check and let the modal reflect whatever
      // is actually true now.
      const fresh = await loadWorkoutExecution(user.uid, recovery.state.pointer.executionId);
      if (!fresh || fresh.status !== 'IN_PROGRESS') {
        await recovery.recheck();
        return;
      }
      execution.adoptExecution(fresh);
      workoutCompletionRef.current = null;
      workoutHomeSyncRef.current = null;
      setWorkoutCompletionResult(null);
      setWorkoutCompletionFailureCategory(null);
      setDurableCompletionReachedAtMs(null);
      setFinishingSession(false);
      setActiveSessionIndex(fresh.sessionIndex);
      setWorkoutInProgress(true);
      setWorkoutExecutionVisible(true);
      setTab('workout');
      beginPersistedWorkoutSession(fresh, fresh.sessionIndex);
      recovery.resolve();
      void widgetSnapshotSync.resyncNow();
    } finally {
      setRecoveryAction('idle');
    }
  };

  const handleDiscardRecovery = async () => {
    if (recoveryAction !== 'idle' || !user) return;
    if (recovery.state.status !== 'pending' && recovery.state.status !== 'inconsistent') return;
    const { pointer } = recovery.state;
    setRecoveryAction('discarding');
    setRecoveryFinishError(false);
    setRecoveryDiscardError(false);
    try {
      // Safe in every case reachable here: if the execution is already
      // terminal, `abandonWorkoutExecution` only clears the dangling
      // `current` pointer (Rules allow that once the tracked execution is
      // non-IN_PROGRESS) — it never rewrites/resurrects a finished record,
      // and never touches schedule/lifecycle (docs §11).
      await abandonWorkoutExecution(user.uid, pointer.executionId);
      recovery.resolve();
      void widgetSnapshotSync.resyncNow();
    } catch (error) {
      logWarn('workout_execution', 'session_recovery_discard_failed', { error });
      setRecoveryDiscardError(true);
    } finally {
      setRecoveryAction('idle');
    }
  };

  const acknowledgeMissingRecovery = () => {
    if (recoveryAction !== 'idle') return;
    if (recovery.state.status !== 'inconsistent'
      || recovery.state.reason !== 'EXECUTION_MISSING'
      || recovery.state.execution !== null) return;
    setRecoveryFinishError(false);
    setRecoveryDiscardError(false);
    recovery.resolve();
  };

  const runWorkoutCompletion = (
    recovery: boolean,
    actualCardioDurationSeconds?: number,
    mode: WorkoutFinalizationMode = 'NORMAL',
    recoveredExecution?: PersistedWorkoutExecution,
  ): Promise<WorkoutCompletionResult> => {
    if (workoutCompletionRef.current) {
      return workoutCompletionRef.current;
    }
    workoutFinalizationInputRef.current = {
      ...(actualCardioDurationSeconds === undefined ? {} : { actualCardioDurationSeconds }),
      mode,
    };
    setWorkoutFinalizationProgress('WAITING');
    setWorkoutCompletionResult(null);
    setDurableCompletionReachedAtMs(null);
    setFinishingSession(true);
    logInfo('workout_performance', 'finalization_started', { timestampMs: Date.now() });
    const targetExecution = recoveredExecution ?? execution.execution;
    const targetSessionIndex = targetExecution?.sessionIndex ?? activeSessionIndex;
    const hasCardioFinisher = !!activeProgram?.sessions[targetSessionIndex]?.cardioFinisher;
    if (!hasCardioFinisher) {
      logInfo('workout_performance', 'finish_ui_transition_started', { timestampMs: Date.now(), source: 'strength' });
    }
    // Cardio keeps the shared Live Activity in its completed state until the
    // user leaves the success screen, including completion recovery after a
    // process restart. Strength-only behavior is unchanged.
    if (!hasCardioFinisher || mode === 'EARLY') endWorkoutSession();
    const programId = targetExecution?.programId ?? activeProgram?.programId;
    const executionId = targetExecution?.executionId;
    logInfo('workout', 'workout_finish_requested', {
      executionId,
      programId,
      sessionIndex: targetSessionIndex,
      recovery,
      mode,
      stage: 'EXECUTION',
    });
    logInfo('workout', recovery ? 'workout_finish_recovery_started' : 'workout_finish_started', {
      executionId,
      programId,
      sessionIndex: targetSessionIndex,
    });

    return runWorkoutCompletionAttempt(workoutCompletionRef, () => runWorkoutFinalizationWithBestEffortProgress({
      createProgressAttempt: () => {
        workoutFinalizationProgressAttemptRef.current?.dispose();
        workoutFinalizationProgressAttemptRef.current = null;
        if (!appShellMountedRef.current) {
          return { attemptId: null, reportCheckpoint: () => undefined, dispose: () => undefined };
        }
        return createWorkoutFinalizationProgressAttempt({
          createAttemptId: randomUUID,
          subscribe: user
            ? (attemptId, onStage, onError) => subscribeToWorkoutFinalizationProgress(
                user.uid,
                attemptId,
                onStage,
                onError,
              )
            : undefined,
          onStage: (stage) => {
            if (appShellMountedRef.current) advanceWorkoutFinalizationProgress(stage);
          },
          onInfrastructureError: (phase, error) => {
            logWarn('workout', 'finalization_progress_infrastructure_failed', { phase, error });
          },
        });
      },
      onAttemptStarted: (attempt) => {
        if (appShellMountedRef.current) workoutFinalizationProgressAttemptRef.current = attempt;
        else attempt.dispose();
      },
      onAttemptFinished: (attempt) => {
        if (workoutFinalizationProgressAttemptRef.current === attempt) {
          workoutFinalizationProgressAttemptRef.current = null;
        }
      },
      onInfrastructureError: (phase, error) => {
        logWarn('workout', 'finalization_progress_runtime_failed', { phase, error });
      },
      isAuthoritativelyCommitted: (result) => result === 'COMPLETED'
        || result === 'LIFECYCLE_FOLLOW_UP_FAILED',
      runAuthoritative: async (attemptId, reportCheckpoint): Promise<WorkoutCompletionResult> => {
        const finishFlowStartedAtMs = Date.now();
        logInfo('workout_performance', 'finalize_request_start', { timestampMs: finishFlowStartedAtMs });
        try {
        let finalized: { ok: true; result: FinalizeWorkoutSessionResult } | { ok: false; error: unknown };
        if (recoveredExecution) {
          try {
            reportCheckpoint('CLIENT_READY');
            finalized = {
              ok: true,
              result: await finalizeWorkoutSession({
                executionId: recoveredExecution.executionId,
                ...(attemptId ? { attemptId } : {}),
                ...(mode === 'NORMAL' ? {} : { mode }),
                ...(actualCardioDurationSeconds === undefined ? {} : {
                  cardio: { actualDurationSeconds: actualCardioDurationSeconds },
                }),
              }),
            };
          } catch (error) {
            finalized = { ok: false, error };
          }
        } else {
          finalized = await execution.finalize(actualCardioDurationSeconds, mode, {
            ...(attemptId ? { attemptId } : {}),
            onCheckpoint: reportCheckpoint,
          });
        }
        if (!finalized.ok) {
          // The one place the raw callable failure itself is recorded, with
          // enough to correlate across attempts (executionId, retry vs first
          // try, which boundary rejected it, how long it took) — everything
          // downstream only sees the coarser EXECUTION_FAILED/SCHEDULE_FAILED
          // result. Always-on (logError), unlike the dev-only perf timers
          // above: a production retry that fails silently is exactly the gap
          // this closes.
          logError('workout_finalize_callable', finalized.error, {
            executionId,
            isRetry: recovery,
            stage: workoutFinalizationFailureStage(finalized.error),
            errorClass: errorClass(finalized.error),
            durationMs: Date.now() - finishFlowStartedAtMs,
          });
        }
        // A timeout/disconnect can lose the successful callable response
        // after the transaction committed. Before surfacing an error, verify
        // both durable authorities (terminal execution + deterministic
        // schedule event). This read-only reconciliation makes retries and
        // foreground recovery converge without inventing success.
        if (!finalized.ok && user && targetExecution) {
          try {
            const terminal = await loadAuthoritativelyCommittedFinalization({
              executionId: targetExecution.executionId,
              loadExecution: (targetExecutionId) => loadWorkoutExecution(user.uid, targetExecutionId),
              hasCompletionEvent: (candidate) => hasScheduledSessionCompletion({
                uid: user.uid,
                programId: candidate.programId,
                programInstanceId: candidate.programInstanceId,
                sessionIndex: candidate.sessionIndex,
                scheduledLocalDate: candidate.scheduledLocalDate,
                occurrence: candidate.occurrence,
              }),
            });
            if (terminal) {
              if (appShellMountedRef.current) execution.adoptExecution(terminal);
              finalized = {
                ok: true,
                result: {
                  status: 'COMPLETED',
                  executionStatus: terminal.status,
                  cardioStatus: terminal.cardio?.status === 'COMPLETED'
                    ? 'COMPLETED'
                    : terminal.cardio?.status === 'SKIPPED' ? 'SKIPPED' : 'NOT_APPLICABLE',
                  scheduleStatus: 'COMPLETED',
                  completion: terminal.completion,
                },
              };
              // Always-on: this means the callable's response was lost even
              // though the backend actually committed — worth seeing in
              // production, not just __DEV__.
              logWarn('workout', 'finalization_response_reconciled_from_authority', {
                executionId: terminal.executionId,
              });
            } else {
              logWarn('workout', 'finalization_response_reconciliation_not_found', {
                executionId: targetExecution.executionId,
              });
            }
          } catch (reconciliationError) {
            logWarn('workout', 'finalization_response_reconciliation_failed', { reconciliationError });
          }
        }
        if (appShellMountedRef.current) {
          setWorkoutCompletionFailureCategory(
            finalized.ok ? null : classifyWorkoutFinalizationError(finalized.error),
          );
        }
        const result: WorkoutCompletionResult = finalized.ok
          ? 'COMPLETED'
          : workoutFinalizationFailureStage(finalized.error) === 'SCHEDULE'
            ? 'SCHEDULE_FAILED' : 'EXECUTION_FAILED';
        // Recovery storage cleanup is a durable-success side effect, not a UI
        // setter. It remains safe even if AppShell unmounted while the callable
        // was in flight; clearCardioSession already serializes and logs storage
        // failures internally.
        if (result === 'COMPLETED' && hasCardioFinisher) void clearCardioSession();
        if (!appShellMountedRef.current) return result;
        if (result === 'COMPLETED') {
          const durableReachedAtMs = Date.now();
          setDurableCompletionReachedAtMs(durableReachedAtMs);
          logInfo('workout_performance', 'durable_completion_reached', {
            timestampMs: durableReachedAtMs,
            durationMs: durableReachedAtMs - finishFlowStartedAtMs,
          });
          const homeSyncStartedAtMs = Date.now();
          logInfo('workout_performance', 'home_sync_start', { timestampMs: homeSyncStartedAtMs });
          // Widget resync is intentionally separate from
          // `runWorkoutHomeProjectionSync` below: it is not part of that
          // sync's success/failure accounting (`outcome`) and must never
          // block or be blocked by it — it already has its own internal
          // failure handling (`useWidgetSnapshotSync`'s `resyncNow` swallows
          // and logs, never throws). Fired only here, after `result ===
          // 'COMPLETED'` — never optimistically before this point.
          // The execution is already terminal but Schedule is refreshed just
          // below. Publish a neutral workout state now so the widget stops
          // saying "in progress" without briefly advertising the old cursor.
          void widgetSnapshotSync.resyncNow({ scheduleResolution: null });
          workoutHomeSyncRef.current = runWorkoutHomeProjectionSync({
            refreshSchedule: schedule.reload,
            refreshWeek: activitySnapshot.reload,
            refreshFrequency: frequencyWindow.reload,
          }).then((outcome) => {
            logInfo('workout_performance', 'home_sync_end', {
              timestampMs: Date.now(),
              durationMs: Date.now() - homeSyncStartedAtMs,
              success: Object.values(outcome).every((status) => status === 'COMPLETED'),
            });
            return outcome;
          });
          let autoActivated = false;
          workoutCompletionFollowUpRef.current = runWorkoutCompletionFollowUp({
            reconcileLifecycle: async () => {
              if (!user) return;
              const lifecycleStartedAtMs = Date.now();
              logInfo('workout_performance', 'lifecycle_start', { timestampMs: lifecycleStartedAtMs });
              try {
                const lifecycleResult = await processWorkoutLifecycleAfterSession({ uid: user.uid });
                autoActivated = lifecycleResult.autoActivated;
                logInfo('workout_performance', 'lifecycle_end', {
                  timestampMs: Date.now(),
                  durationMs: Date.now() - lifecycleStartedAtMs,
                  success: true,
                });
              } catch (error) {
                logInfo('workout_performance', 'lifecycle_end', {
                  timestampMs: Date.now(),
                  durationMs: Date.now() - lifecycleStartedAtMs,
                  success: false,
                });
                throw error;
              }
            },
            refreshProjections: async () => {
              const refreshStartedAtMs = Date.now();
              logInfo('workout_performance', 'post_finish_refresh_start', { timestampMs: refreshStartedAtMs });
              const refreshes = [
                evolution.refreshProjection(),
                ...(autoActivated ? [reloadPrescription()] : []),
              ];
              const outcomes = await Promise.allSettled(refreshes);
              const failure = outcomes.find((outcome) => outcome.status === 'rejected');
              logInfo('workout_performance', 'post_finish_refresh_end', {
                timestampMs: Date.now(),
                durationMs: Date.now() - refreshStartedAtMs,
                success: !failure,
              });
              if (failure?.status === 'rejected') throw failure.reason;
            },
            onLifecycleFailure: (error) => {
              logWarn('workout', 'workout_finish_lifecycle_follow_up_failed', { error });
            },
            onProjectionFailure: (error) => {
              logWarn('workout', 'workout_finish_projection_refresh_failed', { error });
            },
          });
        }
        logInfo('workout_performance', 'finalize_request_end', {
          timestampMs: Date.now(),
          durationMs: Date.now() - finishFlowStartedAtMs,
          result,
        });
        setWorkoutCompletionResult(result);
        if (result === 'COMPLETED') {
          logInfo('workout', 'workout_finish_succeeded', {
            executionId, programId, sessionIndex: targetSessionIndex, stage: 'COMPLETE', result,
          });
          logInfo('workout', recovery ? 'workout_finish_recovery_completed' : 'workout_finish_completed', {
            executionId, programId, sessionIndex: targetSessionIndex, result,
          });
        } else {
          const stage = result === 'EXECUTION_FAILED'
            ? 'EXECUTION'
            : result === 'SCHEDULE_FAILED' ? 'SCHEDULE' : 'LIFECYCLE_FOLLOW_UP';
          logWarn('workout', 'workout_finish_incomplete', {
            executionId, programId, sessionIndex: targetSessionIndex, stage, result,
          });
          logWarn('workout', recovery ? 'workout_finish_recovery_failed' : 'workout_finish_failed', {
            executionId, programId, sessionIndex: targetSessionIndex, stage, result,
          });
        }
        return result;
        } finally {
          if (appShellMountedRef.current) setFinishingSession(false);
        }
      },
    }));
  };

  const handleFinishRecovery = () => {
    if (recoveryFinishInFlightRef.current || recoveryAction !== 'idle' || !user || !activeProgram) return;
    if (recovery.state.status !== 'pending' && recovery.state.status !== 'inconsistent') return;
    if (!recovery.state.execution) return;

    const recoveredPointer = recovery.state.pointer;
    recoveryFinishInFlightRef.current = true;
    setRecoveryAction('finishing');
    setRecoveryFinishError(false);
    setRecoveryDiscardError(false);

    void (async () => {
      try {
        // The modal snapshot may be minutes old. Re-read the exact execution
        // named by the durable pointer immediately before finalization so a
        // retry/other-device completion always converges on server state.
        const fresh = await loadWorkoutExecution(user.uid, recoveredPointer.executionId);
        if (!fresh || fresh.status === 'ABANDONED') {
          await recovery.recheck();
          return;
        }
        const freshProgramIdentity = fresh.programInstanceId ?? fresh.programId;
        const activeProgramIdentity = activeProgram.programInstanceId ?? activeProgram.programId;
        if (freshProgramIdentity !== activeProgramIdentity) {
          await recovery.recheck();
          return;
        }

        // `recoveryFinalizationMode`'s own short-circuit order
        // (finalizationMode -> hasPendingSet -> cardioSettled) means an
        // authoritative cardio-finisher lookup only ever changes the
        // outcome in the one remaining case: every strength set already
        // settled AND cardio not yet durably COMPLETED/SKIPPED. Mirroring
        // that same order here — rather than always reading the program —
        // means a routine recovery (no cardio finisher, or cardio already
        // settled) never pays for an extra Firestore read it doesn't need.
        const hasPendingSet = fresh.exercises.some((exercise) =>
          exercise.sets.some((set) => set.status === 'PENDING'));
        const cardioSettled = fresh.cardio?.status === 'COMPLETED' || fresh.cardio?.status === 'SKIPPED';
        let hasCardioFinisher = false;
        if (!fresh.finalizationMode && !hasPendingSet && !cardioSettled) {
          // Root-cause fix (2026-10 audit): this used to read
          // `activeProgram.sessions[fresh.sessionIndex]?.cardioFinisher` —
          // AppShell's in-memory cache, which can diverge from the
          // `workoutPrograms/{programId}` document the backend's own
          // preflight re-reads. That divergence is exactly what let the
          // client send `mode=NORMAL` with no cardio payload while the
          // backend still required one, producing `CARDIO_COMPLETION_REQUIRED`
          // on every identical retry. Reading the same authoritative source
          // the backend uses removes the divergence at its source.
          const presence = await resolveAuthoritativeCardioFinisherPresence({
            programId: fresh.programId,
            sessionIndex: fresh.sessionIndex,
            loadProgram: (programId) => loadWorkoutProgramSnapshot(user.uid, programId),
          });
          if (presence === null) {
            // Never guess NORMAL on a failed/ambiguous read — that is the
            // exact divergence this fix removes. Forcing EARLY instead
            // mirrors the already-safe "cardio genuinely pending" branch:
            // idempotent, and — because EARLY only ever writes a cardio
            // field when the session's own fresh read found one — harmless
            // even if this session turns out to have no cardio finisher at
            // all once the next successful read confirms it.
            logWarn('workout_execution', 'recovery_cardio_finisher_lookup_failed', {
              executionId: fresh.executionId,
            });
            hasCardioFinisher = true;
          } else {
            hasCardioFinisher = presence;
          }
        }
        const mode = recoveryFinalizationMode(fresh, hasCardioFinisher);
        const result = await runWorkoutCompletion(true, undefined, mode, fresh);
        if (result !== 'COMPLETED' && result !== 'LIFECYCLE_FOLLOW_UP_FAILED') {
          setRecoveryFinishError(true);
          return;
        }

        // The callable result is the durable authority. This follow-up read
        // exists only to feed the regular completed-workout UI with the real
        // terminal document (completion facts, swept sets and timestamps) —
        // never a client-invented summary projection.
        let terminal: PersistedWorkoutExecution | null = null;
        try {
          const loaded = await loadWorkoutExecution(user.uid, fresh.executionId);
          if (loaded && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(loaded.status)) terminal = loaded;
        } catch (error) {
          logWarn('workout_execution', 'session_recovery_terminal_reload_failed', { error });
        }

        if (terminal) {
          execution.adoptExecution(terminal);
          setActiveSessionIndex(terminal.sessionIndex);
          setWorkoutInProgress(true);
          setWorkoutExecutionVisible(true);
          setTab('workout');
        } else {
          // Completion is already durable, so a secondary read failure must
          // not resurrect the recovery modal. Without an authoritative
          // terminal snapshot there is no honest summary to render; wait for
          // the same projections the normal summary CTA awaits, then reveal
          // Home instead.
          await Promise.all([
            workoutHomeSyncRef.current,
            workoutCompletionFollowUpRef.current,
          ]);
          endWorkoutSession();
          setWorkoutInProgress(false);
          setWorkoutExecutionVisible(false);
          setTab('home');
        }
        recovery.resolve();
      } catch (error) {
        logWarn('workout_execution', 'session_recovery_finish_failed', { error });
        setRecoveryFinishError(true);
      } finally {
        recoveryFinishInFlightRef.current = false;
        setRecoveryAction('idle');
      }
    })();
  };

  const retryWorkoutCompletion = async () => {
    const retryStartedAtMs = Date.now();
    const executionId = execution.execution?.executionId;
    logInfo('workout_retry', 'retry_pressed', {
      timestamp: retryStartedAtMs,
      executionId,
      etapa: 'RETRY',
      durationMs: 0,
    });
    logInfo('workout_retry', 'retry_existing_completion_ref', {
      timestamp: Date.now(),
      executionId,
      etapa: 'SINGLE_FLIGHT',
      durationMs: Date.now() - retryStartedAtMs,
      existing: workoutCompletionRef.current !== null,
    });
    logInfo('workout_retry', 'retry_execution_status', {
      timestamp: Date.now(),
      executionId,
      etapa: 'EXECUTION',
      durationMs: Date.now() - retryStartedAtMs,
      status: execution.execution?.status ?? 'UNKNOWN',
    });
    logInfo('workout_retry', 'retry_flow_started', {
      timestamp: Date.now(),
      executionId,
      etapa: 'FLOW',
      durationMs: Date.now() - retryStartedAtMs,
    });
    try {
      const retryInput = workoutFinalizationInputRef.current;
      const result = await runWorkoutCompletion(
        true,
        retryInput.actualCardioDurationSeconds,
        retryInput.mode,
      );
      logInfo('workout_retry', 'retry_result', {
        timestamp: Date.now(),
        executionId,
        etapa: 'COMPLETE',
        durationMs: Date.now() - retryStartedAtMs,
        result,
        errorCode: result === 'COMPLETED' ? undefined : result,
      });
    } catch (error) {
      // Unlike a normal EXECUTION_FAILED/SCHEDULE_FAILED result (already
      // logWarn'd inside runWorkoutCompletion itself), reaching this catch
      // means the retry attempt threw before even producing a result —
      // exactly the kind of failure that used to vanish behind a dev-only
      // logInfo with no trace in production.
      logError('workout_retry', error, {
        executionId,
        durationMs: Date.now() - retryStartedAtMs,
      });
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!shouldRetryWorkoutCompletionOnForeground({
        appState: state,
        workoutInProgress,
        finishing: finishingSession,
        result: workoutCompletionResult,
      })) return;
      // Retrying the same immutable execution is idempotent. A new sidecar
      // attempt is created, while execution/event identities remain stable.
      void retryWorkoutCompletion();
    });
    return () => subscription.remove();
    // retryWorkoutCompletion intentionally captures the latest execution and
    // exact cardio/mode input; the listener is renewed when those states move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishingSession, workoutCompletionResult, workoutInProgress]);

  const finishWorkoutSession = async () => {
    await runWorkoutCompletionSingleFlight(finishSessionInFlightRef, async () => {
      if (!workoutInProgress) {
        setTab('home');
        return;
      }
      // On the success surface the durable result is already authoritative;
      // the Home CTA must not start a second completion merely because the
      // in-flight-only ref was correctly released after settlement.
      const result = workoutCompletionResult
        ?? (workoutCompletionRef.current
          ? await workoutCompletionRef.current
          : await runWorkoutCompletion(false));
      if (result === 'COMPLETED' || result === 'LIFECYCLE_FOLLOW_UP_FAILED') {
        await Promise.all([
          workoutHomeSyncRef.current,
          workoutCompletionFollowUpRef.current,
        ]);
        logInfo('workout_performance', 'home_ready_after_completion', {
          timestampMs: Date.now(),
          durationFromDurableMs: durableCompletionReachedAtMs === null
            ? null
            : Date.now() - durableCompletionReachedAtMs,
        });
      }
      const navigated = applyWorkoutCompletionNavigation(result, () => {
        logInfo('workout', 'workout_done_navigation_allowed', {
          executionId: execution.execution?.executionId,
          sessionIndex: activeSessionIndex,
          result,
        });
        endWorkoutSession();
        setWorkoutInProgress(false);
        setWorkoutExecutionVisible(false);
        setWorkoutStartAttempt(null);
        setTab('home');
      });
      if (navigated) {
        workoutCompletionRef.current = null;
        workoutFinalizationInputRef.current = { mode: 'NORMAL' };
        workoutFinalizationProgressAttemptRef.current?.dispose();
        workoutFinalizationProgressAttemptRef.current = null;
        setWorkoutFinalizationProgress('WAITING');
        workoutHomeSyncRef.current = null;
        setWorkoutCompletionResult(null);
        setWorkoutCompletionFailureCategory(null);
        setDurableCompletionReachedAtMs(null);
      }
    });
  };

  // Abandon is already the terminal domain mutation. It must only tear down
  // the local workout surface; routing it through finishWorkoutSession would
  // ask the finalizer to finish an ABANDONED record; server authority
  // correctly rejects that as execution_not_finishable.
  const discardWorkout = async () => {
    const result = await runWorkoutDiscardFlow({
      abandon: execution.abandon,
      refreshProjection: evolution.refreshProjection,
      onProjectionFailure: (error) => {
        logWarn('workout_evolution', 'discard_projection_refresh_failed', {
          errorCode: errorCode(error),
        });
      },
    });
    if (result.ok) void widgetSnapshotSync.resyncNow();
    return result;
  };

  const leaveDiscardedWorkout = async () => {
    endWorkoutSession();
    setWorkoutInProgress(false);
    setWorkoutExecutionVisible(false);
    setWorkoutStartAttempt(null);
    workoutCompletionRef.current = null;
    workoutFinalizationInputRef.current = { mode: 'NORMAL' };
    workoutFinalizationProgressAttemptRef.current?.dispose();
    workoutFinalizationProgressAttemptRef.current = null;
    setWorkoutFinalizationProgress('WAITING');
    workoutHomeSyncRef.current = null;
    setWorkoutCompletionResult(null);
    setWorkoutCompletionFailureCategory(null);
    setDurableCompletionReachedAtMs(null);
    setFinishingSession(false);
    setTab('home');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/*
        Main-tab lifecycle policy (docs/23_navegacao_e_lifecycle.md): Home,
        Progress and Profile are lazy-mounted + kept alive + materialized
        via `PersistentScreen` — each mounts (Progress/Profile: prewarmed
        ahead of the user's tap) and then stays mounted AND laid out
        (`inactiveMode="materialized"`, never `display:'none'`), only
        toggling opacity/interactivity, so switching tabs back and forth
        never re-triggers a mount *or* a first-layout/paint cycle. Home
        needs no `prewarm` — it's active from the very first render, so it's
        never in a "not yet laid out" state to begin with. Workout uses a
        narrower lifecycle: it mounts only for a real active session, then
        remains mounted while minimized so its exercise/set state and timer
        survive the trip to Home. Do NOT change any of the three below back to a bare
        `tab === 'x' && <Screen/>`, and do NOT give them `inactiveMode`
        `'detached'` — both are exactly the patterns that caused the
        intermittent entry flicker this architecture replaces.
      */}
      <View
        style={{ flex: 1 }}
        pointerEvents={homeVisible ? 'auto' : 'none'}
        accessibilityElementsHidden={!homeVisible}
        importantForAccessibility={homeVisible ? 'auto' : 'no-hide-descendants'}
      >
        <PersistentScreen active={tab === 'home'} activeStyle={FULL_BLEED.tab} inactiveMode="materialized">
          <HomeScreen
            sex={sex}
            prescription={prescription}
            loading={prescriptionLoading}
            generating={generatingWorkout}
            scheduleResolution={schedule.resolution}
            scheduleConfig={schedule.config}
            workoutInProgress={workoutInProgress}
            activeWorkoutSessionIndex={activeSessionIndex}
            activeRest={activeRest}
            restRunning={restStatus === 'running' && activeRest !== null}
            onStart={requestStartWorkout}
            advanceWorkoutTarget={advanceTarget}
            onAdvanceWorkout={requestAdvanceWorkout}
            onOpenProfile={() => setTab('profile')}
            onOpenSupportCases={() => setSupportRoute({ name: 'cases', origin: 'home' })}
            unreadSupportCasesCount={unreadSupportCases.count}
            evolutionViewModel={evolution.viewModel}
            onOpenEvolution={() => setShowEvolutionUnlock(true)}
            weekOverview={schedule.matchesActiveProgram && activitySnapshot.initialStatus === 'SUCCESS'
              && (homeInitialReadiness.today === 'SUCCESS' || authoritativeReadyMarkRef.current)
              ? activitySnapshot.week : (cachedFrequency ? null : activitySnapshot.week)}
            frequencyWindow={frequencyPresentation.source === 'AUTHORITATIVE' ? frequencyPresentation.value : null}
            frequencyLoading={frequencyWindow.loading}
            frequencySource={frequencyPresentation.source === 'CACHE' ? 'CACHE'
              : frequencyWindow.loading ? 'CURRENT_SESSION' : 'AUTHORITATIVE'}
            frequencyCanGoNext={frequencyWindow.canGoNext}
            onFrequencyPrev={frequencyWindow.goPrev}
            onFrequencyNext={frequencyWindow.goNext}
            snapshotFrequencyWindow={frequencyPresentation.source === 'CACHE' ? frequencyPresentation.value : null}
            snapshotFrequencyThrough={cachedFrequency ? homePresentationSnapshot?.sections.frequency.throughLocalDate : undefined}
            snapshotPresentationActive={snapshotPresentationActive}
            todayActionsReady={canUseTodayActions({
              snapshotExists: Boolean(cachedFrequency),
              todayStatus: homeInitialReadiness.today,
              programInstanceId: activeProgram?.programInstanceId ?? null,
              scheduleMatchesActiveProgram: schedule.matchesActiveProgram,
            })}
            todayStatus={homeInitialReadiness.today}
            programPresentationReady={schedule.matchesActiveProgram && Boolean(activeProgram?.programInstanceId)}
            onSnapshotLayoutCommitted={onSnapshotLayoutCommitted}
            homeInitialDataSettled={homeInitialDataSettled}
            homeInitialVisualReady={homeInitialVisualReady}
            onInitialLayoutCommitted={onInitialLayoutCommitted}
            streak={homeStreak}
          />
        </PersistentScreen>
        {tab === 'workout' && workoutStartAttempt && (
          <WorkoutStartVisibilityMetric
            key={workoutStartAttempt.id}
            attempt={workoutStartAttempt}
            onMeasured={clearWorkoutStartAttempt}
          />
        )}
        {tab === 'workout' && (workoutStartPending || execution.starting || (workoutInProgress && !execution.execution)) && (
          <FullScreenLoading accessibilityLabel={t('preparing.title')} />
        )}
        {tab === 'workout' && !workoutStartPending && prescription.status === 'SUCCESS'
          && (!workoutInProgress || !workoutExecutionVisible) && (
          <TreinoScreen
            sex={sex}
            plan={prescription.plan}
            resolution={schedule.resolution}
            completedTodaySessionIndex={schedule.completedTodaySessionIndex}
            scheduleConfig={schedule.config}
            workoutInProgress={workoutInProgress}
            startPending={workoutStartPending || execution.starting}
            onStart={requestStartWorkout}
            onOpenAgendaEditor={() => setAgendaEditorOpen(true)}
            onReposition={requestReposition}
            weekSummary={activitySnapshot.week
              ? { completedCount: activitySnapshot.week.completedCount, scheduledCount: activitySnapshot.week.scheduledCount }
              : null}
            last30DaysCompletedCount={frequencyPresentation.source === 'AUTHORITATIVE' && frequencyPresentation.value
              ? frequencyPresentation.value.completedCount : null}
          />
        )}
        {tab === 'workout' && !workoutInProgress && agendaEditorOpen && activeProgram && (
          <TreinoAgendaSheet
            initialScheduleMode={schedule.config?.scheduleMode ?? 'fixed'}
            initialTrainingDays={schedule.config?.trainingDays ?? []}
            currentFrequency={activeProgram.prescribedTrainingFrequency ?? activeProgram.prescribedStructuredDays ?? activeProgram.sessions.length}
            onClose={() => setAgendaEditorOpen(false)}
            onSave={handleSaveAgenda}
            onChangeFrequency={handleChangeFrequency}
          />
        )}
        {workoutInProgress && !workoutStartPending && !execution.starting && execution.execution && prescription.status === 'SUCCESS' && (
          <View
            pointerEvents={tab === 'workout' && workoutExecutionVisible ? 'auto' : 'none'}
            accessibilityElementsHidden={tab !== 'workout' || !workoutExecutionVisible}
            importantForAccessibility={tab === 'workout' && workoutExecutionVisible ? 'auto' : 'no-hide-descendants'}
            style={[
              FULL_BLEED.tab,
              {
                opacity: tab === 'workout' && workoutExecutionVisible ? 1 : 0,
                zIndex: tab === 'workout' && workoutExecutionVisible ? 1 : 0,
              },
            ]}
          >
            <WorkoutScreen
              sex={sex}
              plan={prescription.plan}
              sessionIndex={activeSessionIndex}
              execution={execution.execution}
              workoutStartedAtMs={execution.workoutStartedAtMs}
              hasUnreconciledMutations={execution.hasUnreconciledMutations}
              onDone={finishWorkoutSession}
              onRetryCompletion={() => { void retryWorkoutCompletion(); }}
              onDiscarded={leaveDiscardedWorkout}
              onMinimize={() => { setWorkoutExecutionVisible(false); setTab('home'); }}
              // Docs §8: `WorkoutScreen` awaits this before navigating away
              // (then calls `onDiscarded`, never the finish callback) —
              // abandon must be a durable, persisted fact before the UI
              // treats the session as gone. Never fire-and-forget here.
              onAbandon={discardWorkout}
              onCardioCompleted={async (actualDurationSeconds) => {
                const result = await runWorkoutCompletion(false, actualDurationSeconds, 'NORMAL');
                return result === 'COMPLETED'
                  ? { ok: true as const }
                  : { ok: false as const, error: new Error(result) };
              }}
              onEarlyFinish={async () => {
                const result = await runWorkoutCompletion(false, undefined, 'EARLY');
                return result === 'COMPLETED'
                  ? { ok: true as const }
                  : { ok: false as const, error: new Error(result) };
              }}
              onSetLogged={(exerciseIndex, setIndex, weightKg, actualReps) =>
                execution.recordSet(exerciseIndex, setIndex, weightKg, actualReps ?? null)}
              onCompletedSetEdited={(exerciseIndex, setIndex, patch) =>
                execution.editCompletedSet(exerciseIndex, setIndex, patch)}
              manualSubstitutionContext={manualSubstitutionContextState.context}
              manualSubstitutionContextStatus={manualSubstitutionContextState.status}
              onRetryManualSubstitutionContext={retryManualSubstitutionContext}
              onApplySubstitution={async ({ exerciseIndex, requestedExerciseId, scope }) => {
                if (!execution.execution) {
                  return { ok: false, error: new Error('NO_ACTIVE_EXECUTION') };
                }
                try {
                  await applyExerciseSubstitution({
                    executionId: execution.execution.executionId,
                    exerciseIndex,
                    requestedExerciseId,
                    scope,
                  });
                  return { ok: true };
                } catch (error) {
                  // Diagnostic hotfix (2026-09 QA): the previous log here
                  // ({ exerciseIndex } only) hid the actual `httpsCallable`
                  // failure reason behind a generic "exercise_substitution_failed"
                  // — indistinguishable from a callable that doesn't exist yet
                  // (functions/not-found), an App Check rejection, an auth
                  // failure, or a genuine candidate rejection from the server
                  // resolver. `code`/`message` are the Firebase Functions SDK's
                  // own closed, non-PII error surface (same extraction pattern
                  // as `accountDeletionReauth.ts`'s `getFirebaseErrorCode`) —
                  // never the request payload, never a stack trace.
                  const code = typeof error === 'object' && error !== null && 'code' in error
                    ? String((error as { code: unknown }).code)
                    : 'unknown';
                  const message = typeof error === 'object' && error !== null && 'message' in error
                    ? String((error as { message: unknown }).message)
                    : 'unknown';
                  logWarn('workout', 'exercise_substitution_failed', { exerciseIndex, scope, code, message });
                  return { ok: false, error };
                }
              }}
              finishing={finishingSession}
              finalizationProgress={workoutFinalizationProgress}
              completionConfirmed={workoutCompletionResult === 'COMPLETED'
                || workoutCompletionResult === 'LIFECYCLE_FOLLOW_UP_FAILED'}
              durableCompletionReachedAtMs={durableCompletionReachedAtMs}
              completionFailed={workoutCompletionResult === 'EXECUTION_FAILED'
                || workoutCompletionResult === 'SCHEDULE_FAILED'}
              completionFailureCategory={workoutCompletionFailureCategory}
              onSessionCompleted={({ recovery, mode }) => {
                void runWorkoutCompletion(recovery, undefined, mode);
              }}
            />
          </View>
        )}
        <PersistentScreen
          active={tab === 'progress'}
          prewarm={prewarmed.PROGRESS}
          activeStyle={FULL_BLEED.tab}
          inactiveMode="materialized"
        >
          <ProgressScreen onOpenAssessment={() => setShowAssessment(true)} />
        </PersistentScreen>
        <PersistentScreen
          active={tab === 'profile'}
          prewarm={prewarmed.PROFILE}
          activeStyle={FULL_BLEED.tab}
          inactiveMode="materialized"
        >
          <ProfileScreen
            onOpenAssessment={() => setShowAssessment(true)}
            onOpenEditProfile={() => setShowEditProfile(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenMyPlan={() => setShowMyPlan(true)}
            evolutionViewModel={evolution.viewModel}
            onOpenEvolution={() => setShowEvolutionUnlock(true)}
          />
        </PersistentScreen>
      </View>
      {/*
        Always mounted (when not on Workout) instead of gated by
        `!overlayOpen`: unmounting the tab bar shrinks its flex-sibling by
        the tab bar's height, so the screen underneath an overlay resized
        (~758px -> ~874px) every time an overlay opened/closed — see
        docs/23_navegacao_e_lifecycle.md "Overlays: estabilidade de
        geometria". Overlays are always fully opaque + position:absolute
        covering the whole viewport, so the tab bar staying laid out (just
        untouchable/inaccessible) underneath is never visible.
      */}
      {!(tab === 'workout' && (workoutExecutionVisible || workoutStartPending || execution.starting)) && (
        <View
          pointerEvents={overlayOpen || !homeInitialVisualReady ? 'none' : 'auto'}
          accessibilityElementsHidden={overlayOpen || !homeInitialVisualReady}
          importantForAccessibility={overlayOpen || !homeInitialVisualReady ? 'no-hide-descendants' : 'auto'}
        >
          <TabBar tab={tab} setTab={selectTab} />
        </View>
      )}
      <StartWorkoutConfirmation
        visible={startWorkoutFlow === 'confirmation' && !workoutInProgress}
        prescription={prescription}
        resolution={schedule.resolution}
        sessionIndex={schedule.resolution.status === 'SESSION_READY'
          ? schedule.resolution.sessionIndex
          : 0}
        loading={prescriptionLoading}
        onCancel={() => setStartWorkoutFlow('idle')}
        onConfirm={startWorkout}
        generating={generatingWorkout}
        onGenerate={() => { void generateWorkout(); }}
      />
      <AdvanceWorkoutConfirmation
        visible={showAdvanceWorkoutConfirmation && advanceTarget !== null && !workoutInProgress}
        target={advanceTarget}
        onCancel={() => setShowAdvanceWorkoutConfirmation(false)}
        onConfirm={() => { void startAdvancedWorkout(); }}
      />
      {/*
        Only ever opened from `requestStartWorkout` (a real "iniciar treino"
        attempt) — never auto-shown on Home mount just because the Schedule
        Engine detected a gap (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md
        §Sessão perdida). Detection/persistence of `pendingMissDecision`
        still happens eagerly inside `resolveTodaysSchedule` regardless of
        whether this is visible — only the DECISION's timing moved, not the
        detection's. Same `startWorkoutFlow` state as
        StartWorkoutConfirmation above, so the two can never both be
        `visible` at once.
      */}
      <WorkoutExecutionPendingModal
        error={startWorkoutError}
        resolving={resolvingPendingExecution}
        onAbandonPrevious={(id) => { void resolvePendingExecutionAndRetry(id); }}
        onContactSupport={() => {
          setStartWorkoutError(null);
          setSupportRoute({ name: 'form', type: 'SUPPORT', subject: t('pendingExecution.supportSubject') });
        }}
        onCancel={() => setStartWorkoutError(null)}
      />
      {/*
        Workout Recovery / Resume após process death (docs) — proactive,
        bootstrap-time detection, rendered independent of `startWorkoutFlow`
        so it can appear before the user taps anything at all. Takes
        precedence over Missed Session and every other overlay (see
        `overlayOpen`/`requestStartWorkout` above).
      */}
      {homeInitialVisualReady ? (
        <WorkoutSessionRecoveryModal
          state={recovery.state}
          canResume={recoveryCanResume}
          canFinalize={recoveryCanFinalize}
          resuming={recoveryAction === 'resuming'}
          finishing={recoveryAction === 'finishing'}
          discarding={recoveryAction === 'discarding'}
          finishError={recoveryFinishError}
          discardError={recoveryDiscardError}
          onResume={() => { void handleResumeRecovery(); }}
          onFinish={handleFinishRecovery}
          onDiscard={() => { void handleDiscardRecovery(); }}
          onAcknowledgeMissing={acknowledgeMissingRecovery}
        />
      ) : null}
      <MissedSessionDecisionModal
        visible={startWorkoutFlow === 'missedDecision'}
        pending={missedDecisionPending}
        refreshing={schedule.loading}
        error={missedDecisionError}
        onChoose={(decision) => { void handleMissDecision(decision); }}
        onCancel={cancelMissDecision}
      />
      <Modal
        visible={showEvolutionUnlock
          && (evolution.viewModel.kind === 'EVOLUTION_READY'
            || evolution.viewModel.kind === 'EVOLUTION_DEFERRED'
            || evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE')}
        animationType={reduceMotion ? 'none' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE') {
            void evolution.acknowledgeAutoActivation();
          }
          setShowEvolutionUnlock(false);
        }}
      >
        {(evolution.viewModel.kind === 'EVOLUTION_READY'
          || evolution.viewModel.kind === 'EVOLUTION_DEFERRED'
          || evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE') ? (
          <EvolutionUnlockScreen
            viewModel={evolution.viewModel}
            diff={evolution.diff}
            actionPending={evolution.actionPending}
            actionError={evolution.actionError}
            onStart={() => {
              void evolution.start().then(async (activated) => {
                if (!activated) return;
                await reloadPrescription();
                setShowEvolutionUnlock(false);
              });
            }}
            onDefer={() => {
              void evolution.defer().then((deferred) => {
                if (deferred) setShowEvolutionUnlock(false);
              });
            }}
            onClose={() => {
              if (evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE') {
                void evolution.acknowledgeAutoActivation();
              }
              setShowEvolutionUnlock(false);
            }}
          />
        ) : null}
      </Modal>
      {/*
        Settings, Security, Assessment, EditProfile, Consistency, Support
        (help/success halves) and SubscriptionCenter are the secondary
        screens audited safe for prewarm + materialized keep-alive so far
        (docs/23_navegacao_e_lifecycle.md §5/§14) — each either has zero
        `useEffect`, or had its mount-tied effect migrated to
        `useScreenFocusEffect` (see AssessmentScreen/SubscriptionCenterScreen)
        and its form fields migrated to an explicit activation reset (see
        EditProfileScreen/SupportFormScreen). Every other secondary screen
        below is still a bare `{showX && (...)}` conditional (ephemeral) —
        each needs its own audit before it can move to this pattern.
      */}
      <PersistentScreen
        active={showAssessment}
        prewarm={prewarmed.ASSESSMENT}
        activeStyle={FULL_BLEED.overlayZ40}
        inactiveMode="materialized"
      >
        <AssessmentScreen onBack={() => setShowAssessment(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showSettings}
        prewarm={prewarmed.SETTINGS}
        activeStyle={FULL_BLEED.overlayZ40}
        inactiveMode="materialized"
      >
        <SettingsScreen
          onBack={() => setShowSettings(false)}
          onOpenEditProfile={() => setShowEditProfile(true)}
          onOpenSecurity={() => setShowSecurity(true)}
          onOpenNotifications={() => setShowNotificationSettings(true)}
          onOpenAccount={() => setShowAccountSettings(true)}
          onOpenHelpCenter={() => setSupportRoute({ name: 'help' })}
          onReportProblem={() => {
            setLastFormRoute({ type: 'BUG' });
            setSupportRoute({ name: 'form', type: 'BUG' });
          }}
          onSendSuggestion={() => {
            setLastFormRoute({ type: 'FEEDBACK' });
            setSupportRoute({ name: 'form', type: 'FEEDBACK' });
          }}
        />
      </PersistentScreen>
      {/* NotificationSettingsScreen (docs/23_navegacao_e_lifecycle.md §6):
          migrated from the bare conditional above to PersistentScreen —
          it was added after that doc's migration round and had simply never
          been audited into the pattern, the exact class of entry-flicker
          the doc describes (mount always pays real native layout/paint cost
          synchronously with the tap that reveals it). `key={uid}` stays on
          the screen itself, not the wrapper: it still forces a full remount
          on account switch (unrelated to, and unaffected by, this wrapper's
          own permanent-once-mounted tracking). */}
      <PersistentScreen
        active={showNotificationSettings}
        prewarm={prewarmed.NOTIFICATION_SETTINGS}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <NotificationSettingsScreen key={user?.uid ?? 'signed-out'} onBack={() => setShowNotificationSettings(false)} />
      </PersistentScreen>
      {showAccountSettings ? (
        <View style={FULL_BLEED.overlayZ50}>
          <AccountSettingsScreen
            onBack={() => setShowAccountSettings(false)}
            onOpenSubscription={() => setShowSubscriptionCenter(true)}
            onOpenDeleteAccount={() => setShowDeleteAccount(true)}
          />
        </View>
      ) : null}
      <PersistentScreen
        active={showSecurity}
        prewarm={prewarmed.SECURITY}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <SecurityScreen
          onBack={() => setShowSecurity(false)}
          onOpenChangePassword={canChangePassword ? () => setShowChangePassword(true) : undefined}
        />
      </PersistentScreen>
      {/*
        ChangePassword (docs/23_navegacao_e_lifecycle.md §10): the visual
        shell is prewarmed + materialized like every other screen above, but
        the screen wipes its password fields when it deactivates through its
        `useScreenFocusEffect` cleanup. No password remains alive while the
        screen is materialized but inactive.
      */}
      <PersistentScreen
        active={showChangePassword && canChangePassword}
        prewarm={prewarmed.CHANGE_PASSWORD}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <ChangePasswordScreen onBack={() => setShowChangePassword(false)} />
      </PersistentScreen>
      {/* DeleteAccountScreen is a direct child of Security. Its shell is
          safe to prewarm because provider/password material exists only
          after interaction, and the flow resets on deactivation. */}
      <PersistentScreen
        active={showDeleteAccount}
        prewarm={prewarmed.DELETE_ACCOUNT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <DeleteAccountScreen onBack={() => setShowDeleteAccount(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showEditProfile}
        prewarm={prewarmed.EDIT_PROFILE}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <EditProfileScreen onBack={() => setShowEditProfile(false)} />
      </PersistentScreen>
      {/*
        Meu Plano is a pure VIEW of `prescription`/`schedule` — the exact
        same values AppShell already resolved above for Home/Workout. It
        never mounts its own `useWorkoutPrescription`/`useWorkoutSchedule`,
        so opening it can never trigger a second reconciliation/generation
        attempt.
      */}
      {/*
        No `prewarm` — PREWARM_ROUTE_IDS (src/lib/prewarmRoutes.ts) is a
        curated, per-screen-audited list; this screen hasn't been through
        that audit. Lazy-mount + keep-alive only (same pattern as
        HelpArticleScreen/SupportFormScreen): first open pays a normal mount
        cost, every subsequent open is a pure activity toggle.
      */}
      <PersistentScreen
        active={showMyPlan}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <MyPlanScreen
          prescription={prescription}
          loading={prescriptionLoading}
          schedule={schedule}
          onBack={() => setShowMyPlan(false)}
          onRetry={() => { void reloadPrescription(); }}
        />
      </PersistentScreen>
      <PersistentScreen
        active={showSubscriptionCenter}
        prewarm={prewarmed.SUBSCRIPTION_CENTER}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <SubscriptionCenterScreen
          onBack={() => setShowSubscriptionCenter(false)}
          onRenew={() => {
            setShowSubscriptionCenter(false);
            setShowPremium(true);
          }}
        />
      </PersistentScreen>
      {showPremium && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}>
          <PaywallScreen
            onClose={() => setShowPremium(false)}
            closeAccessibilityLabel="Fechar assinatura"
          />
        </View>
      )}
      {/*
        Support flow (docs/23_navegacao_e_lifecycle.md §14, "Suporte"):
        HelpCenter and Success take no data prop, so both are fully
        prewarm+materialized like every other screen above. HelpArticle and
        SupportForm need real data (`article`/`type`) that doesn't exist
        before the user's first real navigation there — prewarming them
        with placeholder data would be meaningless, so they're only
        lazy-mount + keep-alive (`active` alone, no `prewarm`): their FIRST
        opening still pays a real mount cost (same as any newly-visited
        persistent screen before this round's prewarm work), every
        subsequent switch between any of the 4 support screens is a pure
        activity toggle. `lastArticle`/`lastFormRoute` (declared above) keep
        the last real prop values alive so these two can stay materialized
        with valid props even while `supportRoute` has moved elsewhere.
      */}
      <PersistentScreen
        active={supportRoute?.name === 'help'}
        prewarm={prewarmed.SUPPORT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <HelpCenterScreen
          onBack={() => setSupportRoute(null)}
          onOpenArticle={(article) => {
            setLastArticle(article);
            setSupportRoute({ name: 'article', article });
          }}
          onOpenReportProblem={() => {
            setLastFormRoute({ type: 'BUG' });
            setSupportRoute({ name: 'form', type: 'BUG' });
          }}
          onOpenSuggestion={() => {
            setLastFormRoute({ type: 'FEEDBACK' });
            setSupportRoute({ name: 'form', type: 'FEEDBACK' });
          }}
          onOpenTalkToSupport={() => {
            setLastFormRoute({ type: 'SUPPORT' });
            setSupportRoute({ name: 'form', type: 'SUPPORT' });
          }}
          onOpenMySupportCases={() => setSupportRoute({ name: 'cases', origin: 'help' })}
        />
      </PersistentScreen>
      {lastArticle && (
        <PersistentScreen
          active={supportRoute?.name === 'article'}
          activeStyle={FULL_BLEED.overlayZ60}
          inactiveMode="materialized"
        >
          <HelpArticleScreen
            article={lastArticle}
            onBack={() => setSupportRoute({ name: 'help' })}
            onOpenTicket={(subject) => {
              setLastFormRoute({ type: 'SUPPORT', subject });
              setSupportRoute({ name: 'form', type: 'SUPPORT', subject });
            }}
          />
        </PersistentScreen>
      )}
      <PersistentScreen
        active={supportRoute?.name === 'form'}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <SupportFormScreen
          type={lastFormRoute.type}
          initialSubject={lastFormRoute.subject}
          onBack={() => setSupportRoute(null)}
          onSuccess={() => setSupportRoute({ name: 'success' })}
        />
      </PersistentScreen>
      <PersistentScreen
        active={supportRoute?.name === 'success'}
        prewarm={prewarmed.SUPPORT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <SupportSuccessScreen onBack={() => setSupportRoute(null)} />
      </PersistentScreen>
      {supportRoute?.name === 'cases' ? (
        <View style={FULL_BLEED.overlayZ60}>
          <SupportCasesScreen
            onBack={() => setSupportRoute(supportRoute.origin === 'help' ? { name: 'help' } : null)}
            onOpenCase={(caseId) => setSupportRoute({
              name: 'case',
              caseId,
              casesOrigin: supportRoute.origin,
            })}
          />
        </View>
      ) : null}
      {supportRoute?.name === 'case' ? (
        <View style={FULL_BLEED.overlayZ60}>
          <SupportCaseDetailScreen
            caseId={supportRoute.caseId}
            onBack={() => setSupportRoute({ name: 'cases', origin: supportRoute.casesOrigin })}
          />
        </View>
      ) : null}
      {!homeVisible ? (
        <View
          testID="home-initial-loading-overlay"
          pointerEvents="auto"
          accessibilityViewIsModal
          style={FULL_BLEED.overlayZ70}
        >
          <FullScreenLoading />
        </View>
      ) : null}
    </View>
  );
}

function AdvanceWorkoutConfirmation({
  visible,
  target,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  target: AdvancedWorkoutTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const theme = darkTheme;
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const weekday = target
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(`${target.scheduledLocalDate}T12:00:00Z`))
    : '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('schedule.advance.dismiss')}
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: 34,
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 340,
            alignSelf: 'center',
            borderRadius: 16,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.primaryBorderQuiet,
            backgroundColor: theme.colors.background,
          }}
        >
          <LinearGradient
            colors={theme.gradients.poster}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <HudCorners color={theme.colors.hudCorner} />
            <Slash accentColor={theme.colors.primaryEmphasis} textColor={theme.colors.textFaint}>
              {t('todayCard.kicker').toUpperCase()}
            </Slash>
            <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
              {t('schedule.advance.confirmTitle').toUpperCase()}
            </Display>
            <Text style={{
              color: theme.colors.textSecondaryStrong,
              fontFamily: theme.fonts.ui,
              fontSize: 13,
              lineHeight: 19,
              marginTop: 8,
            }}>
              {t('schedule.advance.confirmBody', { weekday })}
            </Text>

            <PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>
              {({ locked, onPress }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onCancel();
                    onPress();
                  }}
                  style={{
                    height: 48,
                    marginTop: 18,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: theme.colors.inverseSurface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                  }}
                >
                  <Icon name={locked ? 'lock' : 'arrow-right'} size={12} color={theme.colors.inverseForeground} />
                  <Text style={{
                    color: theme.colors.inverseForeground,
                    fontFamily: theme.fonts.display,
                    fontSize: 15,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                  }}>
                    {t('schedule.advance.confirm')}
                  </Text>
                </Pressable>
              )}
            </PremiumAction>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
            >
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                {t('schedule.advance.cancel')}
              </Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function StartWorkoutConfirmation({
  visible,
  prescription,
  resolution,
  sessionIndex,
  loading,
  onCancel,
  onConfirm,
  generating,
  onGenerate,
}: {
  visible: boolean;
  prescription: PrescriptionResult;
  /** Same Schedule Engine resolution AppShell reads to gate `startWorkout`
   *  (docs §Bloqueio real) — used here only to decide which copy to show;
   *  the actual gate still lives in `startWorkout` itself. */
  resolution: ScheduleResolution;
  /** Same scheduled session displayed on the Home card. */
  sessionIndex: number;
  /** Same meaning as `useWorkoutPrescription`'s `loading` — see HomeScreen's doc comment. Keeps this modal from ever reading `prescription.status` as a real outcome before the first resolution lands. */
  loading: boolean;
  onCancel: () => void;
  /** FASE 5: this is the pure "start the session" action — it runs only
   *  when `<PremiumAction>` below has already allowed it. The caller no
   *  longer needs to know START_WORKOUT is a Premium capability at all. */
  onConfirm: () => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  // Product invariant: this confirmation belongs to the same Dark artwork
  // as the Today Workout poster, even when the surrounding app uses Light.
  const theme = darkTheme;
  const { t } = useTranslation('home');
  const tLoose = t as unknown as LooseTranslate;
  const canStart = prescription.status === 'SUCCESS';

  // Not a training day / already trained today: same `schedule.*` copy as
  // `WorkoutTabBlockedState`, so the navbar's "Treino" tab never disagrees
  // with Home about whether today is resting/done (docs §Consistência com
  // Meu Plano). This takes precedence over the prescription outcome —
  // there's no reason to show a prescription error for a day that was never
  // going to start a session anyway.
  const blockedCopyKey =
    resolution.status === 'REST_DAY' ? 'restDay' :
    resolution.status === 'ACTIVE_RECOVERY_DAY' ? 'activeRecovery' :
    resolution.status === 'TODAY_COMPLETED' ? 'completedToday' :
    null;
  const nextUp = canStart
    && (resolution.status === 'REST_DAY' || resolution.status === 'ACTIVE_RECOVERY_DAY' || resolution.status === 'TODAY_COMPLETED')
    ? { session: prescription.plan.sessions[resolution.nextSessionIndex] ?? null, date: resolution.nextWorkoutDate }
    : null;

  const session = !blockedCopyKey && canStart
    ? prescription.plan.sessions[sessionIndex] ?? prescription.plan.sessions[0]
    : null;
  const showLoadingState = loading && !canStart;
  const outcomeKey = showLoadingState
    ? 'loadingState'
    : generating
      ? 'generatingState'
      : canStart
        ? 'unavailable' // unused when canStart — title/body below branch on `canStart` first
        : prescriptionOutcomeKey(prescription.status);
  return (
    <Modal
      visible={visible}
      transparent
      // Keep the confirmation interactive from its first rendered frame.
      // Native modal presentation animations can swallow a quick follow-up
      // tap while the new window is still transitioning onto the screen.
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('todayCard.confirm.accessibilityClose', {
          defaultValue: t('todayCard.confirm.dismiss'),
        })}
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlayStrong,
          justifyContent: 'center',
          paddingHorizontal: 34,
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 340,
            alignSelf: 'center',
            borderRadius: 16,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.primaryBorderQuiet,
            backgroundColor: theme.colors.background,
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={theme.gradients.poster}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <HudCorners color={theme.colors.hudCorner} />
            <OutlineNumber
              size={118}
              color={theme.colors.decorativeOutline}
              style={{
                position: 'absolute',
                top: -28,
                right: -8,
                opacity: 0.28,
              }}
            >
              04
            </OutlineNumber>

            <Slash
              accentColor={theme.colors.primaryEmphasis}
              textColor={theme.colors.textFaint}
            >
              {t('todayCard.kicker').toUpperCase()}
            </Slash>
            <Display size={26} color={theme.colors.textPrimary} style={{ marginTop: 9 }}>
              {t(
                blockedCopyKey
                  ? `schedule.${blockedCopyKey}.title`
                  : canStart
                    ? 'todayCard.confirm.title'
                    : `prescription.${outcomeKey}.title`,
              ).toUpperCase()}
            </Display>
            <Text
              style={{
                color: theme.colors.textSecondaryStrong,
                fontFamily: theme.fonts.ui,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              {blockedCopyKey
                ? t(`schedule.${blockedCopyKey}.body`)
                : canStart
                  ? t('todayCard.confirm.question')
                  : t(`prescription.${outcomeKey}.body`)}
            </Text>
            <Text
              style={{
                color: theme.colors.textPrimary,
                fontFamily: theme.fonts.uiBold,
                fontSize: 14,
                lineHeight: 20,
                marginTop: 1,
              }}
            >
              {session
                ? resolveSessionDisplayName(
                    tLoose,
                    session.name,
                    session.type,
                    session.displayName,
                  )
                : ''}
            </Text>

            {/* Not a training day / already trained today: point at the
                next scheduled session instead of offering to start one now
                (docs §Próximo treino != próximo dia) — same card shape as
                `WorkoutTabBlockedState`'s. */}
            {nextUp?.session && (
              <Card style={{ marginTop: 14, padding: 14 }}>
                <MonoLabel>{t('schedule.nextWorkout.label').toUpperCase()}</MonoLabel>
                <Text
                  style={{
                    fontFamily: theme.fonts.uiBold,
                    fontSize: 15,
                    color: theme.colors.textPrimary,
                    marginTop: 6,
                  }}
                >
                  {t('schedule.nextWorkout.value', {
                    weekday: tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate(nextUp.date)}`),
                    session: resolveSessionDisplayName(tLoose, nextUp.session.name, nextUp.session.type),
                  })}
                </Text>
              </Card>
            )}

            {/* FASE 5: <PremiumAction> is the entry-point gate — locked stays
                tappable (never `disabled`), and closes this confirmation
                before either starting the session or opening
                PremiumRequiredSheet, exactly like the Fase 4 behavior this
                replaces. Never shown when today is blocked (rest/active
                recovery/already completed) — there's nothing to start. */}
            {canStart && !blockedCopyKey && <PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>
              {({ locked, onPress }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    locked
                      ? t('todayCard.confirm.accessibilityConfirmLocked')
                      : t('todayCard.confirm.accessibilityConfirm')
                  }
                  onPress={() => {
                    onCancel();
                    onPress();
                  }}
                  style={{
                    height: 48,
                    marginTop: 18,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: theme.colors.inverseSurface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                  }}
                >
                  <Icon name={locked ? 'lock' : 'play'} size={12} color={theme.colors.inverseForeground} />
                  <Text
                    style={{
                      color: theme.colors.inverseForeground,
                      fontFamily: theme.fonts.display,
                      fontSize: 15,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('todayCard.confirm.startNow')}
                  </Text>
                </Pressable>
              )}
            </PremiumAction>}
            {/*
              Fallback only — automatic reconciliation (`useWorkoutPrescription`)
              already retries on every app open. This button exists for a
              technical/persistence failure a manual retry might actually fix
              (`canRetryGeneration`); it never appears for
              `NEEDS_QUESTIONNAIRE_UPDATE` (retrying with the same answers
              fails identically — the user must update the questionnaire) or
              for `BLOCKED`/`REQUIRES_CLEARANCE` (fail-closed; a retry button
              here would look like a way around a safety stop).
            */}
            {!blockedCopyKey && !canStart && !generating && !showLoadingState && canRetryGeneration(prescription.status) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('prescription.generate')}
                disabled={generating}
                onPress={onGenerate}
                style={{
                  height: 48,
                  marginTop: 18,
                  borderRadius: 10,
                  borderBottomRightRadius: 0,
                  backgroundColor: theme.colors.inverseSurface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: generating ? 0.6 : 1,
                }}
              >
                <Text style={{
                  color: theme.colors.inverseForeground,
                  fontFamily: theme.fonts.display,
                  fontSize: 15,
                  letterSpacing: 1.4,
                  textTransform: 'uppercase',
                }}>
                  {t(generating ? 'prescription.generating' : 'prescription.generate')}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
            >
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13 }}>
                {t('todayCard.confirm.notNow')}
              </Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Renders in place of `WorkoutScreen` for every non-`SESSION_READY`
 * resolution (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Bloqueio real) —
 * the same `home:schedule.*` copy Home uses, so the Treino tab and Home can
 * never disagree about whether today is done/resting (docs §Consistência
 * com Meu Plano). No "iniciar novamente" affordance exists here at all —
 * this screen has no start action, only a way back.
 */
function WorkoutTabBlockedState({
  resolution,
  plan,
  onDone,
}: {
  resolution: Exclude<ScheduleResolution, { status: 'SESSION_READY' }>;
  plan: FinalWorkoutPlan;
  onDone: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const tLoose = t as unknown as LooseTranslate;

  const copyKey =
    resolution.status === 'TODAY_COMPLETED' ? 'completedToday' :
    resolution.status === 'REST_DAY' ? 'restDay' :
    resolution.status === 'ACTIVE_RECOVERY_DAY' ? 'activeRecovery' :
    resolution.status === 'SCHEDULE_SETUP_REQUIRED' ? 'setupRequired' :
    resolution.status === 'MISSED_SESSION_DECISION_REQUIRED' ? 'missedDecision' :
    null;

  const nextUp = resolution.status === 'REST_DAY' || resolution.status === 'ACTIVE_RECOVERY_DAY' || resolution.status === 'TODAY_COMPLETED'
    ? { session: plan.sessions[resolution.nextSessionIndex] ?? null, date: resolution.nextWorkoutDate }
    : null;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 36 }}>
          <OutlineNumber
            size={280}
            color={theme.colors.decorativeOutline}
            style={{ position: 'absolute', top: -40, right: -60, opacity: 0.35 }}
          >
            {resolution.status === 'TODAY_COMPLETED' ? '✓' : '—'}
          </OutlineNumber>

          <Slash style={{ marginBottom: 14 }}>
            {(copyKey ? t(`schedule.${copyKey}.title`) : t('todayCard.kicker')).toUpperCase()}
          </Slash>
          <Display size={28} style={{ marginTop: 4, maxWidth: 300 }}>
            {(copyKey ? t(`schedule.${copyKey}.body`) : '').toUpperCase()}
          </Display>

          {nextUp?.session && (
            <Card style={{ marginTop: 30, padding: 18 }}>
              <MonoLabel>{t('schedule.nextWorkout.label').toUpperCase()}</MonoLabel>
              <Text
                style={{
                  fontFamily: theme.fonts.uiBold,
                  fontSize: 18,
                  color: theme.colors.textPrimary,
                  marginTop: 8,
                }}
              >
                {t('schedule.nextWorkout.value', {
                  weekday: tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate(nextUp.date)}`),
                  session: resolveSessionDisplayName(tLoose, nextUp.session.name, nextUp.session.type),
                })}
              </Text>
            </Card>
          )}

          <View style={{ flex: 1 }} />
          <CtaButton onPress={onDone}>
            <Text
              style={{
                color: theme.colors.primaryForeground,
                fontFamily: theme.fonts.display,
                fontSize: 15,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {tLoose('common:actions.back')}
            </Text>
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}

function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('common');
  const { profile } = useAuth();
  const profilePhotoURL = profile?.profile.photoURL;
  const items: { id: TabId; icon: IconName; labelKey: 'home' | 'workout' | 'progress' | 'profile' }[] = [
    { id: 'home', icon: 'home', labelKey: 'home' },
    { id: 'workout', icon: 'dumbbell', labelKey: 'workout' },
    { id: 'progress', icon: 'chart', labelKey: 'progress' },
    { id: 'profile', icon: 'user', labelKey: 'profile' },
  ];
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
      <View style={{ paddingHorizontal: 14, paddingBottom: 6, paddingTop: 8 }}>
        <View
          style={{
            backgroundColor: theme.navigation.barBackground,
            borderWidth: 1,
            borderColor: theme.navigation.border,
            borderRadius: 18,
            padding: 7,
            flexDirection: 'row',
            ...theme.shadows.nav,
          }}
        >
          {items.map((it) => {
            const active = tab === it.id;
            return (
              <Pressable
                key={it.id}
                onPress={() => setTab(it.id)}
                style={{
                  flex: 1,
                  paddingTop: 9,
                  paddingBottom: 7,
                  borderRadius: 12,
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: active ? theme.navigation.activeBackground : 'transparent',
                }}
              >
                {active && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '30%',
                      right: '30%',
                      height: 2,
                      backgroundColor: theme.navigation.active,
                      borderRadius: 2,
                    }}
                  />
                )}
                {it.id === 'profile' && profilePhotoURL ? (
                  <Image
                    source={versionedPhotoURL(
                      profilePhotoURL,
                      profile?.profile.photoVersion,
                    )}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    transition={120}
                    priority="high"
                    accessible={false}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                    }}
                  />
                ) : (
                  <Icon
                    name={it.icon}
                    size={20}
                    color={active ? theme.navigation.active : theme.navigation.inactiveIcon}
                    stroke={active ? 2.1 : 1.7}
                  />
                )}
                <Text
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: 8.5,
                    letterSpacing: 1.5,
                    color: active ? theme.navigation.active : theme.navigation.inactiveLabel,
                  }}
                >
                  {t(`navigation.${it.labelKey}`).toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}
