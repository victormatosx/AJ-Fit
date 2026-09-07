import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from '../components/ui/Icon';
import { Card, HudCorners } from '../components/ui/Card';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { CtaButton } from '../components/ui/CtaButton';
import { ScreenBg } from '../components/ui/ScreenBg';
import { darkTheme, useTheme } from '../theme';
import { useAppState, TabId } from '../state/AppState';
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
import type { HelpArticle, SupportTicketType } from '../types/support';
import { PersistentScreen } from '../components/navigation/PersistentScreen';
import { usePrewarmQueue } from '../components/navigation/usePrewarmQueue';
import { useSubscription } from '../hooks/useSubscription';
import {
  INITIAL_PAYWALL_PREMIUM_RETURN_STATE,
  resolvePaywallPremiumReturn,
} from '../lib/paywallPremiumReturn';
import { useWorkoutPrescription } from '../workoutPrescription/useWorkoutPrescription';
import type { FinalWorkoutPlan, PrescriptionResult } from '../workoutPrescription/types';
import { canRetryGeneration, prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import type { WorkoutProgramSnapshot } from '../services/workoutPrograms';
import {
  localDateInTimezone,
  useWorkoutSchedule,
  weekdayOfLocalDate,
  type ScheduleResolution,
} from '../scheduleEngine';
import { MissedSessionDecisionModal } from '../components/schedule/MissedSessionDecisionModal';
import { useWorkoutExecution } from '../workoutExecution/useWorkoutExecution';
import { activeExecutionId } from '../services/workoutExecutions';
import { completeWorkoutSessionFlow } from '../workoutLifecycle/finishFlow';
import { useWorkoutEvolution } from '../workoutEvolution/useWorkoutEvolution';
import { useWorkoutActivitySnapshot } from '../home/useWorkoutActivitySnapshot';
import { useFrequencyWindow } from '../home/useFrequencyWindow';
import { processWorkoutLifecycleAfterSession } from '../services/workoutLifecycleApplication';
import { EvolutionUnlockScreen } from './EvolutionUnlockScreen';
import { logInfo, logWarn } from '../lib/logger';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { useReducedMotionPreference } from '../lib/reducedMotion';
import { useDeepLinkIntent } from '../state/DeepLinkContext';
import { RestSessionProvider, useRestSession } from '../state/RestSessionContext';

type SupportRoute =
  | { name: 'help' }
  | { name: 'article'; article: HelpArticle }
  | { name: 'form'; type: SupportTicketType; subject?: string }
  | { name: 'success' };

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
export function AppShell() {
  const [showPremium, setShowPremium] = useState(false);
  const { user } = useAuth();
  return (
    <PremiumActionProvider onRequestUpgrade={() => setShowPremium(true)}>
      <RestSessionProvider key={user?.uid ?? 'signed-out'}>
        <AppShellContent showPremium={showPremium} setShowPremium={setShowPremium} />
      </RestSessionProvider>
    </PremiumActionProvider>
  );
}

function AppShellContent({
  showPremium,
  setShowPremium,
}: {
  showPremium: boolean;
  setShowPremium: (value: boolean) => void;
}) {
  const { theme } = useTheme();
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
  const execution = useWorkoutExecution(activeProgram, schedule.config?.timezone);
  // Fase 5 — single canonical evolution view-model/actions for the whole
  // app (docs product §144/§146); reconciles once per AppShell mount.
  const evolution = useWorkoutEvolution();
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
    trainingDays: schedule.config?.trainingDays ?? [],
    activeRecoveryDays: schedule.config?.activeRecoveryDays ?? [],
    activatedAtLocalDate,
  });
  // "Sua frequência" — independently paginated (30-day blocks), same
  // canonical `workoutExecutions` completion source, own bounded/cached read.
  const frequencyWindow = useFrequencyWindow(schedule.config?.timezone ?? deviceTimezone());
  const { pendingIntent, consumeIntent } = useDeepLinkIntent();
  const { beginWorkoutSession, endWorkoutSession } = useRestSession();
  const [activeSessionIndex, setActiveSessionIndex] = useState(0);
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
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showMyPlan, setShowMyPlan] = useState(false);
  const [showSubscriptionCenter, setShowSubscriptionCenter] = useState(false);
  const [showWorkoutConfirmation, setShowWorkoutConfirmation] = useState(false);
  const [showEvolutionUnlock, setShowEvolutionUnlock] = useState(false);
  const [supportRoute, setSupportRoute] = useState<SupportRoute | null>(null);
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
  const overlayOpen =
    showAssessment ||
    showSettings ||
    showSecurity ||
    showChangePassword ||
    showEditProfile ||
    showMyPlan ||
    showSubscriptionCenter ||
    showDeleteAccount ||
    showPremium ||
    !!supportRoute;

  useEffect(() => {
    if (!canChangePassword) setShowChangePassword(false);
  }, [canChangePassword]);

  // Explain a persisted AUTO activation at the next safe app surface. Never
  // interrupt a live workout, a confirmation, or another overlay.
  useEffect(() => {
    if (
      evolution.viewModel.kind === 'AUTO_ACTIVATION_NOTICE'
      && tab !== 'workout'
      && !overlayOpen
      && !showWorkoutConfirmation
    ) {
      // Hydrate the ProgramInstance that the persisted event says is active,
      // but only after leaving the live Workout surface.
      void reloadPrescription();
      setShowEvolutionUnlock(true);
    }
  }, [evolution.viewModel.kind, overlayOpen, reloadPrescription, showWorkoutConfirmation, tab]);

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

  const selectTab = (nextTab: TabId) => {
    if (nextTab === 'workout' && tab !== 'workout') {
      setShowWorkoutConfirmation(true);
      return;
    }

    setTab(nextTab);
  };

  useEffect(() => {
    // RootNavigator and the workout-readiness gate have already resolved by
    // the time AppShell mounts. Native taps still reuse the canonical start
    // confirmation and Schedule Engine decision; a deep link never creates
    // or materializes a workout session on its own.
    if (!pendingIntent || overlayOpen || showEvolutionUnlock) return;

    if (pendingIntent.type === 'active-workout') {
      if (tab !== 'workout' && !showWorkoutConfirmation) {
        setShowWorkoutConfirmation(true);
      }
      consumeIntent(pendingIntent);
    }
  }, [
    consumeIntent,
    overlayOpen,
    pendingIntent,
    showEvolutionUnlock,
    showWorkoutConfirmation,
    tab,
  ]);

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
  const startWorkout = () => {
    if (prescription.status !== 'SUCCESS') return;
    setShowWorkoutConfirmation(false);
    setTab('workout');
    // BLOQUEIO REAL (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md §Bloqueio
    // real): the Schedule Engine resolution — not this button, not whatever
    // tab the user happened to land on — is what decides whether a session
    // may start. Only SESSION_READY ever sets `activeSessionIndex`/calls
    // `execution.start`; REST_DAY, TODAY_COMPLETED, SCHEDULE_SETUP_REQUIRED,
    // PROGRAM_NOT_AVAILABLE and a pending miss decision all fall through to
    // the Workout tab's own blocked-state render below instead of a live
    // session — a stale confirmation, a deep link or a re-tap can reach this
    // function in any of those states and still can never open a second
    // session for a day already resolved (idempotent otherwise: a double
    // tap or a cold-start reopen resumes the same execution, docs §22-25).
    if (schedule.resolution.status === 'SESSION_READY') {
      const sessionIndex = schedule.resolution.sessionIndex;
      setActiveSessionIndex(sessionIndex);
      const executionScopeId = activeProgram?.programInstanceId ?? activeProgram?.programId;
      const scheduledLocalDate = localDateInTimezone(
        new Date(),
        schedule.config?.timezone ?? deviceTimezone(),
      );
      beginWorkoutSession(
        executionScopeId
          ? activeExecutionId(executionScopeId, sessionIndex, scheduledLocalDate)
          : undefined,
      );
      void execution.start(sessionIndex);
    }
  };

  const finishWorkoutSession = () => {
    endWorkoutSession();
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
        never in a "not yet laid out" state to begin with. Workout is the
        deliberate exception (still plain conditional render) — it's a live
        session screen; see the doc for why persisting it wasn't a safe
        default. Do NOT change any of the three below back to a bare
        `tab === 'x' && <Screen/>`, and do NOT give them `inactiveMode`
        `'detached'` — both are exactly the patterns that caused the
        intermittent entry flicker this architecture replaces.
      */}
      <View style={{ flex: 1 }}>
        <PersistentScreen active={tab === 'home'} activeStyle={FULL_BLEED.tab} inactiveMode="materialized">
          <HomeScreen
            prescription={prescription}
            loading={prescriptionLoading}
            generating={generatingWorkout}
            scheduleResolution={schedule.resolution}
            onStart={() => setShowWorkoutConfirmation(true)}
            onOpenProfile={() => setTab('profile')}
            evolutionViewModel={evolution.viewModel}
            onOpenEvolution={() => setShowEvolutionUnlock(true)}
            weekOverview={activitySnapshot.week}
            frequencyWindow={frequencyWindow.viewModel}
            frequencyLoading={frequencyWindow.loading}
            frequencyCanGoNext={frequencyWindow.canGoNext}
            onFrequencyPrev={frequencyWindow.goPrev}
            onFrequencyNext={frequencyWindow.goNext}
          />
        </PersistentScreen>
        {tab === 'workout' && prescription.status === 'SUCCESS' && schedule.resolution.status !== 'SESSION_READY' && (
          <WorkoutTabBlockedState
            resolution={schedule.resolution}
            plan={prescription.plan}
            onDone={finishWorkoutSession}
          />
        )}
        {tab === 'workout' && prescription.status === 'SUCCESS' && schedule.resolution.status === 'SESSION_READY' && (
          <WorkoutScreen
            plan={prescription.plan}
            sessionIndex={activeSessionIndex}
            onDone={finishWorkoutSession}
            onMinimize={() => setTab('home')}
            onAbandon={() => { void execution.abandon(); }}
            onSetLogged={(exerciseIndex, setIndex, weightKg) =>
              execution.recordSet(exerciseIndex, setIndex, weightKg)}
            onSessionCompleted={() => {
              // The workout engine remains authoritative for completion and
              // evolution. The rest layer only closes its temporal surface
              // before those durable transitions start.
              endWorkoutSession();
              // Execution finishes first (COMPLETED/PARTIALLY_COMPLETED),
              // then the Schedule Engine advances via its own existing,
              // already-idempotent completion mechanism — no parallel
              // "advance the rotation" logic here (docs §40). Progression is
              // only ever checked AFTER the session has fully ended — never
              // while one is IN_PROGRESS (docs/workout-lifecycle/
              // 04_PROGRESSION_ENGINE.md §23-25).
              const programId = activeProgram?.programId;
              // Diagnostic instrumentation (Phase 2, Part F) — a prior E2E
              // reported a crash on finishing a workout. That report was
              // later traced to a separate, now-fixed cause (Schedule stuck
              // in SCHEDULE_SETUP_REQUIRED, so Workout Execution never
              // actually started — Phase 1). No uncaught-throw path was
              // found in this chain on audit (`execution.finish`/
              // `schedule.completeSession` are both already internally
              // try/caught) — this logs the boundary so the next real E2E
              // either confirms it's clean or pinpoints exactly where it
              // isn't.
              logInfo('workout', 'workout_finish_requested', {
                programId,
                sessionIndex: activeSessionIndex,
              });
              void (async () => {
                const result = await completeWorkoutSessionFlow({
                  finishExecution: execution.finish,
                  completeSchedule: () => schedule.completeSession(activeSessionIndex),
                  afterSchedule: async () => {
                    if (!user) return;
                    const lifecycleResult = await processWorkoutLifecycleAfterSession({ uid: user.uid });
                    if (lifecycleResult.autoActivated) await reloadPrescription();
                    await evolution.refresh();
                    await activitySnapshot.reload();
                    await frequencyWindow.reload();
                  },
                });
                // The "treino concluído" screen (WorkoutScreen's own
                // `finished` local state) already rendered by this point,
                // independent of this result — so a non-COMPLETED outcome
                // can never be silently indistinguishable from success in
                // the logs. `EXECUTION_FAILED`/`SCHEDULE_FAILED` mean the
                // WorkoutExecution finished but the Schedule Engine never
                // advanced (no scheduleEvent COMPLETED, Home keeps offering
                // the same session) — never masked as
                // `workout_finish_succeeded` the way it was before this was
                // logged. Deliberately not attempting any rollback/retry
                // here: the execution is already a durable terminal fact
                // (docs — `finishFlow.ts`'s own doc comment), and the next
                // trusted reconciliation entry point (cold start/readiness
                // gate) is the safe place to retry, not this fire-and-forget
                // handler.
                if (result === 'COMPLETED') {
                  logInfo('workout', 'workout_finish_succeeded', { programId, sessionIndex: activeSessionIndex });
                } else {
                  logWarn('workout', 'workout_finish_incomplete', { programId, sessionIndex: activeSessionIndex, result });
                }
              })();
            }}
          />
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
            onOpenSubscription={() => setShowSubscriptionCenter(true)}
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
      {tab !== 'workout' && (
        <View
          pointerEvents={overlayOpen ? 'none' : 'auto'}
          accessibilityElementsHidden={overlayOpen}
          importantForAccessibility={overlayOpen ? 'no-hide-descendants' : 'auto'}
        >
          <TabBar tab={tab} setTab={selectTab} />
        </View>
      )}
      <StartWorkoutConfirmation
        visible={showWorkoutConfirmation}
        prescription={prescription}
        loading={prescriptionLoading}
        onCancel={() => setShowWorkoutConfirmation(false)}
        onConfirm={startWorkout}
        generating={generatingWorkout}
        onGenerate={() => { void generateWorkout(); }}
      />
      <MissedSessionDecisionModal
        visible={tab !== 'workout' && schedule.resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'}
        onChoose={(decision) => { void schedule.resolveMiss(decision); }}
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
          onOpenHelpCenter={() => setSupportRoute({ name: 'help' })}
          onReportProblem={() => {
            setLastFormRoute({ type: 'BUG' });
            setSupportRoute({ name: 'form', type: 'BUG' });
          }}
          onSendSuggestion={() => {
            setLastFormRoute({ type: 'FEEDBACK' });
            setSupportRoute({ name: 'form', type: 'FEEDBACK' });
          }}
          onOpenDeleteAccount={() => setShowDeleteAccount(true)}
        />
      </PersistentScreen>
      <PersistentScreen
        active={showSecurity}
        prewarm={prewarmed.SECURITY}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <SecurityScreen
          onBack={() => setShowSecurity(false)}
          onOpenChangePassword={canChangePassword ? () => setShowChangePassword(true) : undefined}
          onOpenDeleteAccount={() => setShowDeleteAccount(true)}
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
        />
      </PersistentScreen>
      <PersistentScreen
        active={showSubscriptionCenter}
        prewarm={prewarmed.SUBSCRIPTION_CENTER}
        activeStyle={FULL_BLEED.overlayZ50}
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
    </View>
  );
}

function StartWorkoutConfirmation({
  visible,
  prescription,
  loading,
  onCancel,
  onConfirm,
  generating,
  onGenerate,
}: {
  visible: boolean;
  prescription: PrescriptionResult;
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
  const canStart = prescription.status === 'SUCCESS';
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
      animationType="fade"
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
              {t(canStart ? 'todayCard.confirm.title' : `prescription.${outcomeKey}.title`).toUpperCase()}
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
              {canStart
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
              {canStart ? `${prescription.plan.templateId} · ${prescription.plan.split}` : ''}
            </Text>

            {/* FASE 5: <PremiumAction> is the entry-point gate — locked stays
                tappable (never `disabled`), and closes this confirmation
                before either starting the session or opening
                PremiumRequiredSheet, exactly like the Fase 4 behavior this
                replaces. */}
            {canStart && <PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>
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
            {!canStart && !generating && !showLoadingState && canRetryGeneration(prescription.status) && (
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
