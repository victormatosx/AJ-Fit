import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { CtaButton, CtaText } from '../components/ui/CtaButton';
import { darkTheme, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { getDisplayFirstName } from '../lib/userName';
import { recordPerfMark } from '../lib/perf';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { localDateInTimezone, weekdayOfLocalDate, type ScheduleResolution } from '../scheduleEngine';
import { completedTodayNextLabel } from './completedTodayNote';
import { HomeEvoTicker } from '../components/home/HomeEvoTicker';
import { AjCyclePausedMoment } from '../components/aj/AjCyclePausedMoment';
import { CycleProgressBlock } from '../components/home/CycleProgressBlock';
import { PendingEvolutionBanner } from '../components/home/PendingEvolutionBanner';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { PrescriptionDiffSummary } from '../workoutEvolution/diff';
import { FrequencyHeatmap } from '../components/home/FrequencyHeatmap';
import type { FrequencyWindowViewModel } from '../home/frequencyHeatmap';
import type { WeeklyFrequency } from '../home/weeklyFrequency';
import type { InitialSectionStatus } from '../home/homeInitialReadiness';
import type { ActiveRest } from '../lib/restTimer';
import { WorkoutRestHeaderStatus } from '../components/workout/WorkoutRestHeaderStatus';
import { CompletedTodayButton, useCompletedTodayEntrance } from '../components/workout/CompletedTodayButton';
import { AdvanceWorkoutButton } from '../components/workout/AdvanceWorkoutButton';
import { NextWorkoutRow } from '../components/workout/NextWorkoutRow';
import { SupportInboxButton } from '../components/support/SupportInboxButton';
import type { AdvancedWorkoutTarget } from '../scheduleEngine/advanceWorkout';
import { estimateSessionMinutes } from '../home/sessionDuration';

// Lifecycle claims on Home come from the shared EvolutionViewModel.

// Product invariant: the Today Workout poster keeps the official Dark art
// direction in both app themes. This is intentionally scoped to this card;
// surrounding Home surfaces still follow the active theme.
const TODAY_WORKOUT_THEME = darkTheme;
const MISSED_INFO_POPOVER_WIDTH = 220;

export function HomeScreen({
  prescription,
  loading,
  generating,
  scheduleResolution,
  workoutInProgress = false,
  activeWorkoutSessionIndex,
  activeRest = null,
  restRunning = false,
  onStart,
  advanceWorkoutTarget = null,
  onAdvanceWorkout,
  onOpenProfile,
  onOpenSupportCases,
  unreadSupportCasesCount = 0,
  evolutionViewModel,
  evolutionDiff = null,
  onOpenEvolution,
  streak = null,
  dailyStreak = null,
  frequencyWindow,
  weeklyFrequency,
  frequencyLoading,
  frequencySource = 'AUTHORITATIVE',
  frequencyCanGoNext,
  onFrequencyPrev,
  onFrequencyNext,
  snapshotFrequencyWindow = null,
  snapshotFrequencyThrough,
  snapshotPresentationActive = false,
  todayActionsReady = false,
  todayStatus = 'PENDING',
  onSnapshotLayoutCommitted,
  homeInitialDataSettled = false,
  homeInitialVisualReady = false,
  onInitialLayoutCommitted,
  ringCelebrationRequest = null,
  onRingCelebrationFinished,
  ajMomentsAllowed = false,
}: {
  prescription: PrescriptionResult;
  /**
   * True until the FIRST resolution of `prescription` for the current
   * identity lands (`useWorkoutPrescription`'s own `loading`) — while true,
   * `prescription.status` may still be an internal placeholder and must
   * never be read. Distinct from `generating`: this covers the ordinary
   * "we haven't read Firestore yet" window (happy path, no engine running),
   * so it renders a neutral loading state, never the "generating"/"needs
   * questionnaire update" copy below.
   */
  loading?: boolean;
  /** True while automatic reconciliation or the manual fallback is generating the first/updated program — shown in place of the outcome copy below, never alongside it. */
  generating?: boolean;
  /** Schedule Engine's read on "what to train right now" (docs/workout-lifecycle/03_SCHEDULE_ENGINE.md). Optional — omitted callers keep the pre-Schedule-Engine behavior of always showing session 0. */
  scheduleResolution?: ScheduleResolution;
  /** Switches the Today card from a start action to a direct resume action. */
  workoutInProgress?: boolean;
  /** Latched session being performed; it remains stable while the schedule reconciles. */
  activeWorkoutSessionIndex?: number;
  /** Canonical absolute-deadline rest state shared with the live workout. */
  activeRest?: ActiveRest | null;
  restRunning?: boolean;
  onStart: () => void;
  /** Present only when AppShell's strict fixed/rest/tomorrow gate passes. */
  advanceWorkoutTarget?: AdvancedWorkoutTarget | null;
  onAdvanceWorkout?: () => void;
  onOpenProfile: () => void;
  /** Opens "Meus atendimentos" (SupportCasesScreen). Home only owns the entry point/badge — routing/observing lives in AppShell. */
  onOpenSupportCases?: () => void;
  /** Sum of unread ADMIN messages across the user's support cases, from `useUnreadSupportCasesCount` (Firestore `unreadByUserCount`, realtime) — never a locally tracked counter. */
  unreadSupportCasesCount?: number;
  /** Real Training Level/Cycle/progress state, rendered as the `HomeEvoTicker` marquee + `CycleProgressBlock` ring — the historical Home ticker's visual identity (commit d24319b) rebuilt on real data instead of its old hardcoded mock stats. Profile renders this same view model through its own card. */
  evolutionViewModel: EvolutionViewModel;
  /** Real source-vs-target diff for a pending evolution — powers `PendingEvolutionBanner`'s swap-count copy. `null` while no diff has resolved yet. */
  evolutionDiff?: PrescriptionDiffSummary | null;
  onOpenEvolution?: () => void;
  /** Obligations/weeks streak (`useHomeStreak`) — still feeds schedule-driven metrics. */
  streak?: import('../home/streak').Streak | null;
  /** Daily activity streak (workout OR food entry) — drives the flame and the ticker. */
  dailyStreak?: import('../home/dailyActivityStreak').DailyActivityStreak | null;
  /** Real "sua frequência" 30-day window (one block at a time) — `null` only until the very first read ever resolves; the section is simply omitted until then rather than showing a fabricated/empty skeleton. Never goes back to `null` afterward — a newly-selected but not-yet-loaded period keeps showing the previous one (see `frequencyLoading`) so the section's geometry never changes and the surrounding scroll position is never disturbed. */
  frequencyWindow?: FrequencyWindowViewModel | null;
  /** "Frequência desta semana" — distinct days trained over the weekly goal. */
  weeklyFrequency?: WeeklyFrequency | null;
  /** True while a newly-selected period's data isn't available yet — `frequencyWindow` is still the previous period. */
  frequencyLoading?: boolean;
  frequencySource?: 'CACHE' | 'CURRENT_SESSION' | 'AUTHORITATIVE';
  /** False on the most recent (current) 30-day window — the "next" control must be disabled/hidden there. */
  frequencyCanGoNext?: boolean;
  onFrequencyPrev?: () => void;
  onFrequencyNext?: () => void;
  snapshotFrequencyWindow?: FrequencyWindowViewModel | null;
  snapshotFrequencyThrough?: string;
  snapshotPresentationActive?: boolean;
  todayActionsReady?: boolean;
  todayStatus?: InitialSectionStatus;
  onSnapshotLayoutCommitted?: () => void;
  /** Bootstrap-only: mounts a fresh layout marker only after every required Home section is terminal. */
  homeInitialDataSettled?: boolean;
  homeInitialVisualReady?: boolean;
  onInitialLayoutCommitted?: () => void;
  /** Bumps (new `token`) to play the cycle ring's "evolution reached" celebration, scrolling Home to top first — see `CycleProgressBlock`'s matching prop. */
  ringCelebrationRequest?: { token: number } | null;
  onRingCelebrationFinished?: () => void;
  /** AppShell's "Home is the surface the user is actually looking at, and nothing else owns the screen" gate — the only thing allowed to let AJ's paused-cycle moment appear uninvited. Home itself never derives this; it cannot see the tab or the other overlays. */
  ajMomentsAllowed?: boolean;
}) {
  const { theme } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!ringCelebrationRequest) return;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [ringCelebrationRequest]);
  useEffect(() => {
    recordPerfMark('home_mount');
    // The Evolution ticker/strip container is unconditionally part of Home's
    // layout from the very first render (LOADING already renders a shell,
    // never nothing) — Fase 5.2 progressive rendering baseline.
    recordPerfMark('evolution_shell_visible');
  }, []);
  useEffect(() => {
    if (!loading && !generating && scheduleResolution &&
        (prescription.status !== 'SUCCESS' || scheduleResolution.status !== 'PROGRAM_NOT_AVAILABLE')) {
      recordPerfMark('home_today_ready');
    }
  }, [loading, generating, prescription.status, scheduleResolution]);
  useEffect(() => {
    // SUMMARY_READY (Fase 5.2) is an intermediate, non-final state — excluded
    // here so this mark keeps its exact original meaning (fires only once
    // Evolution has reached a truly terminal/authoritative state), never
    // silently redefined by the new progressive-rendering step.
    if (evolutionViewModel.kind !== 'LOADING' && evolutionViewModel.kind !== 'SUMMARY_READY' &&
        evolutionViewModel.kind !== 'ERROR') recordPerfMark('home_evolution_ready');
  }, [evolutionViewModel]);
  const { t, i18n } = useTranslation(['home', 'profile', 'treino']);
  const [showMissedPendingInfo, setShowMissedPendingInfo] = useState(false);
  // Popover renders in a full-screen Modal (so a tap anywhere outside it can
  // close it, unclipped by the poster's `overflow: hidden`) — its position is
  // measured from the icon rather than laid out in-flow alongside it.
  const missedInfoIconRef = useRef<View>(null);
  const [missedInfoAnchor, setMissedInfoAnchor] = useState<{ top: number; left: number } | null>(null);
  const { user, profile } = useAuth();
  const firstName = getDisplayFirstName({
    profileName: profile?.profile.name,
    authDisplayName: user?.displayName,
    email: user?.email ?? profile?.profile.email,
    // Visual-only fallback: never persisted, always resolves in the active
    // locale. `getDisplayFirstName` returns 'Atleta' as its literal last
    // resort — we replace that here so it becomes "Athlete" / "Atleta" in en/es.
  });
  const localizedFirstName = (
    firstName === 'Atleta' ? t('profile:fallback.athlete') : firstName
  ).toUpperCase();
  // `loading` only forces the neutral loading copy when there's no known
  // SUCCESS yet — a refresh that already has a valid plan on screen keeps
  // showing it instead of flashing "loading" over real data. While
  // `generating`, the card shows the in-flight copy regardless of the last
  // known `prescription.status` — reconciliation/manual retry are about to
  // replace it with a real outcome, so the stale one is never shown
  // mid-attempt (`docs/workout-lifecycle` — distinguishes "generating" from
  // every terminal outcome, incl. "not generated yet").
  const showLoadingState = (Boolean(loading) && prescription.status !== 'SUCCESS')
    || (snapshotPresentationActive && !todayActionsReady);
  const outcomeKey = showLoadingState
    ? 'loadingState'
    : generating
      ? 'generatingState'
      : prescription.status === 'SUCCESS'
        ? null
        : prescriptionOutcomeKey(prescription.status);
  const scheduledSessionIndex = workoutInProgress
    ? activeWorkoutSessionIndex ?? 0
    : scheduleResolution?.status === 'SESSION_READY'
      ? scheduleResolution.sessionIndex
      : scheduleResolution?.status === 'MISSED_SESSION_DECISION_REQUIRED'
        // No decision has been made yet, so there's no single "today's
        // session" — CONTINUE_SEQUENCE (the primary option once the user
        // taps "Iniciar treino") is what would run, so it previews best.
        ? scheduleResolution.missedSessionIndex
        : 0;
  // Discreet, non-blocking indication only — MISSED_SESSION_DECISION_REQUIRED
  // deliberately does NOT join `scheduleOverrideKey` below: the card keeps
  // its normal actionable title/CTA, and the decision itself is only asked
  // once the user actually taps "Iniciar treino" (AppShell's
  // `requestStartWorkout`), never automatically here.
  const showMissedPendingNotice = todayActionsReady && !workoutInProgress
    && scheduleResolution?.status === 'MISSED_SESSION_DECISION_REQUIRED';
  // Same copy Treino's own CTA uses (`TreinoScreen`'s `ctaLabel`) — the two
  // screens start the very same session, so they must never name it differently.
  const startCtaLabel = t(workoutInProgress
    ? 'treino:currentWorkout.continue'
    : prescription.status === 'SUCCESS'
      ? 'home:todayCard.start'
      : 'home:todayCard.review');
  const firstSession = prescription.status === 'SUCCESS'
    ? prescription.plan.sessions[scheduledSessionIndex] ?? prescription.plan.sessions[0]
    : null;
  // REST_DAY/TODAY_COMPLETED/SCHEDULE_SETUP_REQUIRED only override the card
  // when there is otherwise a ready program — a legacy/blocked prescription
  // keeps its own outcome copy above (docs/workout-lifecycle/
  // 03_SCHEDULE_ENGINE.md §UI mínima). REST_DAY and TODAY_COMPLETED never
  // offer "Iniciar treino" again today — the CTA below is swapped for a
  // "próximo treino" info row instead (docs §Bloqueio real): the domain
  // layer (Schedule Engine resolution itself, not just this button) is what
  // actually prevents a second session the same day.
  const scheduleOverrideKey = workoutInProgress
    ? null
    : prescription.status !== 'SUCCESS'
    ? null
    : scheduleResolution?.status === 'REST_DAY'
      ? 'restDay'
      : scheduleResolution?.status === 'ACTIVE_RECOVERY_DAY'
        ? 'activeRecovery'
      : scheduleResolution?.status === 'TODAY_COMPLETED'
        ? 'completedToday'
        : scheduleResolution?.status === 'SCHEDULE_SETUP_REQUIRED'
          ? 'setupRequired'
          : null;
  const isBlockedToday = !workoutInProgress && (
    scheduleResolution?.status === 'REST_DAY'
    || scheduleResolution?.status === 'ACTIVE_RECOVERY_DAY'
    || scheduleResolution?.status === 'TODAY_COMPLETED'
  );
  const canAdvanceWorkout = !workoutInProgress
    && scheduleResolution?.status === 'REST_DAY'
    && advanceWorkoutTarget != null
    && onAdvanceWorkout != null;
  // AJ's paused-cycle moment (presentation only). `pausedAtLocalDate` is the
  // same already-computed pause fact the ring above renders as "pausado" —
  // never a second miss count. It is only offered when the normal "Iniciar
  // treino" CTA below is genuinely actionable: today isn't already done/rest,
  // the actions have settled, and there's a real program to start — so AJ
  // can never ask "quer treinar hoje?" where tapping yes would do nothing.
  const cyclePaused = evolutionViewModel.kind !== 'LOADING'
    && evolutionViewModel.kind !== 'ERROR'
    && evolutionViewModel.kind !== 'UNAVAILABLE'
    && evolutionViewModel.summary.pausedAtLocalDate !== null;
  const canStartNow = todayActionsReady
    && !workoutInProgress
    && !isBlockedToday
    && !showLoadingState
    && !generating
    && prescription.status === 'SUCCESS';
  // Session letter ("Treino A/B/C...") mirrors the same convention used by
  // EvolutionUnlockScreen's exercise-swap rows — the session's position in
  // the prescribed rotation, not a stored label.
  const sessionLetter = String.fromCharCode(65 + scheduledSessionIndex);
  const sessionDurationMinutes = firstSession ? estimateSessionMinutes(firstSession) : 0;
  const nextSession = prescription.status === 'SUCCESS' && isBlockedToday
    ? prescription.plan.sessions[(scheduleResolution as { nextSessionIndex: number }).nextSessionIndex] ?? null
    : null;
  const tLoose = t as unknown as LooseTranslate;
  const nextWorkoutLine = nextSession && isBlockedToday
    ? t('home:schedule.nextWorkout.value', {
        weekday: tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate((scheduleResolution as { nextWorkoutDate: string }).nextWorkoutDate)}`),
        session: resolveSessionDisplayName(tLoose, nextSession.name, nextSession.type),
      })
    : null;

  // Today's session is already done: the CTA's slot shows a blocked button
  // plus a note naming the next workout, the same treatment the Treino tab
  // gives it. REST_DAY/ACTIVE_RECOVERY_DAY keep their "próximo treino" row.
  const completedTodayResolution = !workoutInProgress && scheduleResolution?.status === 'TODAY_COMPLETED'
    ? scheduleResolution
    : null;
  const completedNextLabel = completedTodayResolution
    ? completedTodayNextLabel({
        nextWorkoutDate: completedTodayResolution.nextWorkoutDate,
        todayLocalDate: localDateInTimezone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
        todayLabel: tLoose('treino:agenda.today'),
        tomorrowLabel: tLoose('treino:agenda.tomorrow'),
        locale: i18n.resolvedLanguage ?? i18n.language,
      })
    : null;
  const completedTodayNote = completedTodayResolution
    ? completedNextLabel
      ? tLoose('treino:completed.note', { when: completedNextLabel })
      : tLoose('treino:completed.noteNoNext')
    : null;
  // Only cross-fade when the card flipped to "done" with Home already on
  // screen (finishing a session from here) — never when Home opens on an
  // already-completed day, and never when the skeleton settles into it.
  const completedTodayEntering = useCompletedTodayEntrance(
    completedTodayResolution != null,
    todayActionsReady && !isBlockedToday,
  );

  // Today's real locale-formatted calendar date. There is no fixed
  // week-of-program countdown because the lifecycle has no such fact.
  const today = new Date();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const advanceWeekday = advanceWorkoutTarget
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(`${advanceWorkoutTarget.scheduledLocalDate}T12:00:00Z`))
    : '';
  const todayLine = t('home:meta.todayLine', {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(today),
    day: new Intl.DateTimeFormat(locale, { day: '2-digit' }).format(today),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(today),
  });

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* greeting */}
          <View
            style={{
              paddingHorizontal: 22, // matches HomeEvoTicker's own hardcoded gutter below, and Treino's/Dieta's header
              paddingTop: 50 - 10, // screen padding target is 50 total; SafeAreaView already contributes top inset
              paddingBottom: 12,
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <MonoLabel>{todayLine.toUpperCase()}</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }} numberOfLines={2}>
                {`${t('home:greeting.casual')} ${localizedFirstName}.`.toUpperCase()}
              </Display>
            </View>
            {todayActionsReady ? <WorkoutRestHeaderStatus
              workoutInProgress={workoutInProgress}
              rest={activeRest}
              resting={restRunning}
              onPress={onStart}
            /> : null}
            {onOpenSupportCases && unreadSupportCasesCount > 0 && (
              <SupportInboxButton unreadCasesCount={unreadSupportCasesCount} onPress={onOpenSupportCases} />
            )}
            <Pressable onPress={onOpenProfile} hitSlop={8}>
              <ProfileAvatar
                displayName={profile?.profile.name || firstName}
                photoURL={profile?.profile.photoURL}
                photoVersion={profile?.profile.photoVersion}
                size={46}
              />
            </Pressable>
          </View>

          {/* Real Training Level/Cycle/progress state from Workout Lifecycle V2 —
              Home-only HUD marquee + cycle ring (section 2.2/2.3 of the Home
              redesign). */}
          <View style={{ marginTop: 4, marginBottom: 8 }}>
            <HomeEvoTicker
              viewModel={evolutionViewModel}
              streak={dailyStreak}
              sessionsLast30Days={frequencyWindow?.completedCount ?? null}
            />
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            <CycleProgressBlock
              viewModel={evolutionViewModel}
              streak={streak}
              dailyStreak={dailyStreak}
              celebrationRequest={ringCelebrationRequest}
              onCelebrationFinished={onRingCelebrationFinished}
            />
            {(evolutionViewModel.kind === 'EVOLUTION_READY' || evolutionViewModel.kind === 'EVOLUTION_DEFERRED') && onOpenEvolution ? (
              <PendingEvolutionBanner viewModel={evolutionViewModel} diff={evolutionDiff} onPress={onOpenEvolution} />
            ) : null}
          </View>

          {/* TODAY POSTER */}
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 28,
              paddingBottom: 16,
            }}
          >
            <View>
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 11,
                  letterSpacing: 2,
                  color: TODAY_WORKOUT_THEME.colors.textFaint,
                  textTransform: 'uppercase',
                }}
              >
                {(workoutInProgress
                  ? t('home:activeWorkout.kicker')
                  : (!showLoadingState && !generating && !scheduleOverrideKey && firstSession
                    ? t('home:todayCard.kickerWithLetter', { letter: sessionLetter })
                    : t('home:todayCard.kicker'))
                ).toUpperCase()}
              </Text>
              <Text
                style={{
                  fontFamily: theme.fonts.uiBold,
                  fontSize: 30,
                  lineHeight: 36,
                  color: TODAY_WORKOUT_THEME.colors.textPrimary,
                  marginTop: 10,
                }}
              >
                {snapshotPresentationActive && !todayActionsReady
                  ? t(todayStatus === 'ERROR' ? 'home:snapshot.todayUnavailableTitle' : 'home:snapshot.todayPendingTitle')
                  : showLoadingState
                  ? t('home:prescription.loadingState.title')
                  : generating
                    ? t('home:prescription.generatingState.title')
                    : scheduleOverrideKey
                      ? t(`home:schedule.${scheduleOverrideKey}.title`)
                      : firstSession
                        ? resolveSessionDisplayName(t as unknown as LooseTranslate, firstSession.name, firstSession.type, firstSession.displayName)
                        : t(`home:prescription.${outcomeKey}.title` as 'home:prescription.unavailable.title')}
              </Text>
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 14.5,
                  color: TODAY_WORKOUT_THEME.colors.textSecondary,
                  marginTop: 8,
                }}
              >
                {snapshotPresentationActive && !todayActionsReady
                  ? t(todayStatus === 'ERROR' ? 'home:snapshot.todayUnavailableBody' : 'home:snapshot.todayPendingBody')
                  : showLoadingState
                  ? t('home:prescription.loadingState.body')
                  : generating
                    ? t('home:prescription.generatingState.body')
                    : scheduleOverrideKey
                      ? canAdvanceWorkout
                        ? t('home:schedule.advance.helper')
                        : t(`home:schedule.${scheduleOverrideKey}.body`)
                      : workoutInProgress
                        ? t('home:activeWorkout.cardStatus')
                        : prescription.status === 'SUCCESS'
                        ? t('home:todayCard.sessionMetaDuration', {
                            count: firstSession?.exercises.length ?? 0,
                            minutes: sessionDurationMinutes,
                          })
                        : t(`home:prescription.${outcomeKey}.body` as 'home:prescription.unavailable.body')}
              </Text>
            </View>

            {showMissedPendingNotice && (
              <View style={{ position: 'absolute', top: 0, right: 0 }}>
                <Pressable
                  ref={missedInfoIconRef}
                  onPress={() => {
                    missedInfoIconRef.current?.measureInWindow((x, y, width, height) => {
                      setMissedInfoAnchor({
                        top: y + height + 8,
                        left: x + width - MISSED_INFO_POPOVER_WIDTH,
                      });
                    });
                    setShowMissedPendingInfo(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('home:schedule.missedPending.badge.title')}
                  hitSlop={8}
                  style={{
                    width: 30,
                    height: 30,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="alert-triangle" size={15} color={TODAY_WORKOUT_THEME.colors.warning} />
                </Pressable>
              </View>
            )}

            {!todayActionsReady ? (
              <View style={{ alignSelf: 'stretch', height: 54, marginTop: 24, borderRadius: 16, backgroundColor: TODAY_WORKOUT_THEME.colors.surfaceMuted }} />
            ) : isBlockedToday ? (
              completedTodayResolution ? (
                <CompletedTodayButton
                  theme={TODAY_WORKOUT_THEME}
                  label={tLoose('treino:completed.button')}
                  note={completedTodayNote}
                  animate={completedTodayEntering}
                  style={{ alignSelf: 'stretch', marginTop: 20 }}
                />
              ) : canAdvanceWorkout ? (
                <AdvanceWorkoutButton
                  theme={TODAY_WORKOUT_THEME}
                  label={t('home:schedule.advance.cta', { weekday: advanceWeekday })}
                  onPress={onAdvanceWorkout}
                  style={{ alignSelf: 'stretch', marginTop: 24 }}
                />
              ) : nextWorkoutLine && (
                <NextWorkoutRow
                  theme={TODAY_WORKOUT_THEME}
                  label={t('home:schedule.nextWorkout.label')}
                  value={nextWorkoutLine}
                  style={{ alignSelf: 'stretch', marginTop: 24 }}
                />
              )
            ) : (
              <CtaButton
                onPress={onStart}
                style={{ alignSelf: 'stretch', marginTop: 24 }}
                accessibilityLabel={startCtaLabel}
              >
                <Icon
                  name={workoutInProgress ? 'arrow-right' : 'play'}
                  size={15}
                  color={TODAY_WORKOUT_THEME.colors.primaryForeground}
                />
                <CtaText>{startCtaLabel}</CtaText>
              </CtaButton>
            )}
          </View>

          {(frequencyWindow || snapshotFrequencyWindow) && onFrequencyPrev && onFrequencyNext ? (
            <View style={{ marginTop: 28, marginBottom: 8 }}>
              <FrequencyHeatmap
                window={frequencyWindow ?? snapshotFrequencyWindow}
                loading={frequencyWindow ? Boolean(frequencyLoading) : false}
                canGoNext={Boolean(frequencyWindow && frequencyCanGoNext)}
                onPrev={onFrequencyPrev}
                onNext={onFrequencyNext}
                source={frequencyWindow ? frequencySource : 'CACHE'}
                knownThroughLocalDate={frequencyWindow ? undefined : snapshotFrequencyThrough}
                weeklyFrequency={weeklyFrequency ?? null}
              />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={showMissedPendingInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMissedPendingInfo(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home:schedule.missedPending.badge.dismiss')}
          onPress={() => setShowMissedPendingInfo(false)}
          style={{ flex: 1 }}
        >
          {missedInfoAnchor && (
            <Pressable
              accessibilityRole="none"
              onPress={(event) => {
                event.stopPropagation();
                setShowMissedPendingInfo(false);
                onStart();
              }}
              style={{
                position: 'absolute',
                top: missedInfoAnchor.top,
                left: missedInfoAnchor.left,
                width: MISSED_INFO_POPOVER_WIDTH,
                padding: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: TODAY_WORKOUT_THEME.colors.warning,
                backgroundColor: TODAY_WORKOUT_THEME.colors.sheetBackground,
              }}
            >
              <MonoLabel color={TODAY_WORKOUT_THEME.colors.warning}>
                {t('home:schedule.missedPending.badge.title').toUpperCase()}
              </MonoLabel>
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 12,
                  lineHeight: 16,
                  color: TODAY_WORKOUT_THEME.colors.textSecondary,
                  marginTop: 3,
                }}
              >
                {t('home:schedule.missedPending.badge.body')}
              </Text>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* Presentation only — see AjCyclePausedMoment's doc comment. "Sim"
          routes straight back into `onStart`, the single real start-workout
          entry point this card's CTA already uses; nothing here starts,
          resolves or persists anything itself. */}
      <AjCyclePausedMoment
        eligible={cyclePaused && canStartNow}
        allowed={ajMomentsAllowed}
        onStartWorkout={onStart}
      />

      {homeInitialDataSettled && !homeInitialVisualReady && onInitialLayoutCommitted ? (
        <View
          testID="home-initial-layout-commit-marker"
          collapsable={false}
          pointerEvents="none"
          onLayout={onInitialLayoutCommitted}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
      ) : null}
      {snapshotPresentationActive && !homeInitialVisualReady && onSnapshotLayoutCommitted ? (
        <View
          testID="home-snapshot-layout-commit-marker"
          collapsable={false}
          pointerEvents="none"
          onLayout={onSnapshotLayoutCommitted}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
      ) : null}
    </ScreenBg>
  );
}
