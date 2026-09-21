import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { HudCorners } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { darkTheme, useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { getDisplayFirstName } from '../lib/userName';
import { recordPerfMark } from '../lib/perf';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import type { PrescriptionResult } from '../workoutPrescription/types';
import { prescriptionOutcomeKey } from '../workoutPrescription/uiOutcome';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { localDateInTimezone, weekdayOfLocalDate, type ScheduleConfig, type ScheduleResolution } from '../scheduleEngine';
import { EvolutionTicker } from '../components/evolution/EvolutionTicker';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import { BodyMuscleMap } from '../components/fitness/BodyMuscleMap';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import { ProgramProgressStrip } from '../components/home/ProgramProgressStrip';
import { WeeklyOverview } from '../components/home/WeeklyOverview';
import { FrequencyHeatmap } from '../components/home/FrequencyHeatmap';
import { UpcomingWorkouts } from '../components/home/UpcomingWorkouts';
import { UpcomingWorkoutDetailModal } from '../components/home/UpcomingWorkoutDetailModal';
import { buildUpcomingWorkouts, type UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import type { WeekOverviewViewModel } from '../home/weekOverview';
import type { FrequencyWindowViewModel } from '../home/frequencyHeatmap';
import type { ActiveRest } from '../lib/restTimer';
import { WorkoutRestHeaderStatus } from '../components/workout/WorkoutRestHeaderStatus';
import { SupportInboxButton } from '../components/support/SupportInboxButton';
import type { AdvancedWorkoutTarget } from '../scheduleEngine/advanceWorkout';

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
  scheduleConfig,
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
  onOpenEvolution,
  weekOverview,
  frequencyWindow,
  frequencyLoading,
  frequencyCanGoNext,
  onFrequencyPrev,
  onFrequencyNext,
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
  /**
   * The user's real `trainingDays`/`timezone` (same object `useWorkoutSchedule`
   * resolved). Only used to project the "próximos treinos" list forward from
   * `scheduleResolution` — never to re-decide what may be trained today.
   * Omitted/null simply omits that section.
   */
  scheduleConfig?: ScheduleConfig | null;
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
  /** Real Training Level/Cycle/progress state, rendered as the compact `EvolutionTicker` marquee — the historical Home ticker's visual identity (commit d24319b) rebuilt on real data instead of its old hardcoded mock stats. Profile renders this same view model through its own card. */
  evolutionViewModel: EvolutionViewModel;
  onOpenEvolution?: () => void;
  /** Real "esta semana" projection (Schedule Engine config + completed dates) — `null` while the first read is in flight or unavailable; the section is simply omitted rather than showing a fabricated/empty skeleton. */
  weekOverview?: WeekOverviewViewModel | null;
  /** Real "sua frequência" 30-day window (one block at a time) — `null` only until the very first read ever resolves; the section is simply omitted until then rather than showing a fabricated/empty skeleton. Never goes back to `null` afterward — a newly-selected but not-yet-loaded period keeps showing the previous one (see `frequencyLoading`) so the section's geometry never changes and the surrounding scroll position is never disturbed. */
  frequencyWindow?: FrequencyWindowViewModel | null;
  /** True while a newly-selected period's data isn't available yet — `frequencyWindow` is still the previous period. */
  frequencyLoading?: boolean;
  /** False on the most recent (current) 30-day window — the "next" control must be disabled/hidden there. */
  frequencyCanGoNext?: boolean;
  onFrequencyPrev?: () => void;
  onFrequencyNext?: () => void;
}) {
  const { theme } = useTheme();
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
  const { t, i18n } = useTranslation(['home', 'profile']);
  const [showMissedPendingInfo, setShowMissedPendingInfo] = useState(false);
  const [selectedUpcoming, setSelectedUpcoming] = useState<UpcomingWorkoutViewModel | null>(null);
  // Popover renders in a full-screen Modal (so a tap anywhere outside it can
  // close it, unclipped by the poster's `overflow: hidden`) — its position is
  // measured from the icon rather than laid out in-flow alongside it.
  const missedInfoIconRef = useRef<View>(null);
  const [missedInfoAnchor, setMissedInfoAnchor] = useState<{ top: number; left: number } | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  // ~58px validated visually in the body-muscle-map spike; narrower devices
  // (compact iPhones, small Android) shrink it slightly rather than letting
  // it crowd the CTA/next-workout row it now shares a line with.
  const bodyMuscleMapSize = windowWidth < 360 ? 46 : 58;
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
  const showLoadingState = Boolean(loading) && prescription.status !== 'SUCCESS';
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
  const showMissedPendingNotice = !workoutInProgress
    && scheduleResolution?.status === 'MISSED_SESSION_DECISION_REQUIRED';
  const firstSession = prescription.status === 'SUCCESS'
    ? prescription.plan.sessions[scheduledSessionIndex] ?? prescription.plan.sessions[0]
    : null;
  const totalSets = firstSession?.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 0), 0) ?? 0;
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
  // BodyMuscleMap is a read-only visual projection of the session already
  // resolved above (`firstSession.exercises[].exerciseId` is the effective,
  // post-adaptation/substitution/omission id) — it never influences
  // `firstSession` itself. Only computed/shown in the same "ready session"
  // state that renders the title/meta/CTA above (not while
  // loading/generating, and not under a schedule override, which replaces
  // this content with different copy entirely). Requiring at least one
  // resolved primary muscle means a catalog lookup miss degrades to "no
  // map" instead of an empty gray silhouette.
  const sessionExerciseIds = !showLoadingState && !generating && !scheduleOverrideKey && firstSession
    ? firstSession.exercises.map((exercise) => exercise.exerciseId)
    : [];
  const sessionMuscles = deriveSessionMuscles(sessionExerciseIds);
  const showBodyMuscleMap = sessionMuscles.primary.length > 0;
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

  // "Próximos treinos" — the forward view the Today poster deliberately
  // doesn't show. It extends `scheduleResolution` (the engine's own answer
  // for today) over the user's real trainingDays; it never re-decides what
  // may be trained today, and is simply omitted while there's no schedule
  // or no ready program. `localDateInTimezone` is cheap and returns a plain
  // string, so it is a stable `useMemo` dependency across renders.
  const scheduleTimezone = scheduleConfig?.timezone ?? null;
  const todayLocalDate = scheduleTimezone
    ? localDateInTimezone(new Date(), scheduleTimezone)
    : null;
  const upcomingWorkouts = useMemo(
    () => (todayLocalDate && scheduleConfig && prescription.status === 'SUCCESS'
      ? buildUpcomingWorkouts({
          todayLocalDate,
          scheduleMode: prescription.plan.scheduleMode ?? 'fixed',
          trainingDays: scheduleConfig.trainingDays,
          sessions: prescription.plan.sessions,
          resolution: scheduleResolution,
        })
      : []),
    [todayLocalDate, scheduleConfig, prescription, scheduleResolution],
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
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
          {/* greeting */}
          <View
            style={{
              paddingHorizontal: 22,
              paddingBottom: 12,
              paddingTop: 10,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <MonoLabel>
                {todayLine.toUpperCase()}
              </MonoLabel>
              <Display size={28} style={{ marginTop: 6 }} numberOfLines={1}>
                {`${t('home:greeting.casual')} ${localizedFirstName}.`.toUpperCase()}
              </Display>
            </View>
            <WorkoutRestHeaderStatus
              workoutInProgress={workoutInProgress}
              rest={activeRest}
              resting={restRunning}
              onPress={onStart}
            />
            {onOpenSupportCases && unreadSupportCasesCount > 0 && (
              <SupportInboxButton
                unreadCasesCount={unreadSupportCasesCount}
                onPress={onOpenSupportCases}
              />
            )}
            <Pressable onPress={onOpenProfile} hitSlop={8}>
              <ProfileAvatar
                displayName={profile?.profile.name || firstName}
                photoURL={profile?.profile.photoURL}
                photoVersion={profile?.profile.photoVersion}
                size={40}
              />
            </Pressable>
          </View>

          {/* Real Training Level/Cycle/progress state from Workout Lifecycle V2,
              rendered full-bleed like the historical Home ticker. */}
          <View style={{ marginBottom: 18 }}>
            <EvolutionTicker viewModel={evolutionViewModel} onPress={onOpenEvolution} />
          </View>

          {/* TODAY POSTER */}
          <View style={{ paddingHorizontal: 22, paddingBottom: 16 }}>
            <LinearGradient
              colors={TODAY_WORKOUT_THEME.gradients.poster}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16,
                borderBottomRightRadius: 0,
                overflow: 'hidden',
                minHeight: 250,
                borderWidth: 1,
                borderColor: TODAY_WORKOUT_THEME.colors.primaryBorderQuiet,
                padding: 20,
                justifyContent: 'space-between',
              }}
            >
              <HudCorners color={TODAY_WORKOUT_THEME.colors.hudCorner} />
              <View>
                <Slash
                  accentColor={TODAY_WORKOUT_THEME.colors.primaryEmphasis}
                  textColor={TODAY_WORKOUT_THEME.colors.textFaint}
                >
                  {t(workoutInProgress
                    ? 'home:activeWorkout.kicker'
                    : 'home:todayCard.kicker').toUpperCase()}
                </Slash>
                <Display
                  size={38}
                  color={TODAY_WORKOUT_THEME.colors.textPrimary}
                  style={{ marginTop: 12 }}
                >
                  {(showLoadingState
                    ? t('home:prescription.loadingState.title')
                    : generating
                      ? t('home:prescription.generatingState.title')
                      : scheduleOverrideKey
                        ? t(`home:schedule.${scheduleOverrideKey}.title`)
                        : firstSession
                          ? resolveSessionDisplayName(t as unknown as LooseTranslate, firstSession.name, firstSession.type, firstSession.displayName)
                          : t(`home:prescription.${outcomeKey}.title` as 'home:prescription.unavailable.title')
                  ).toUpperCase()}
                </Display>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: 10.5,
                      color: TODAY_WORKOUT_THEME.colors.textSecondary,
                      letterSpacing: 1,
                    }}
                  >
                    {(showLoadingState
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
                            ? t('home:todayCard.sessionMeta', {
                                exercises: firstSession?.exercises.length ?? 0,
                                sets: totalSets,
                              })
                            : t(`home:prescription.${outcomeKey}.body` as 'home:prescription.unavailable.body')
                    ).toUpperCase()}
                  </Text>
                </View>

              </View>

              {showMissedPendingNotice && (
                <View style={{ position: 'absolute', top: 14, right: 14 }}>
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

              {/* CTA/next-workout row shares its row with BodyMuscleMap so the
                  title/meta block above always keeps the full card width —
                  titles vary a lot in length ("PERNAS" vs "PEITO, OMBROS &
                  TRÍCEPS" wrapping to 2-3 lines) and must never fight the map
                  for horizontal space. */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                {isBlockedToday ? (
                  canAdvanceWorkout ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('home:schedule.advance.cta', { weekday: advanceWeekday })}
                      onPress={onAdvanceWorkout}
                      style={{
                        alignSelf: 'flex-start',
                        flexShrink: 1,
                        marginTop: 20,
                        paddingVertical: 15,
                        paddingHorizontal: 20,
                        backgroundColor: TODAY_WORKOUT_THEME.colors.inverseSurface,
                        borderRadius: 10,
                        borderBottomRightRadius: 0,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Icon name="arrow-right" size={13} color={TODAY_WORKOUT_THEME.colors.inverseForeground} />
                      <Text
                        numberOfLines={2}
                        style={{
                          flexShrink: 1,
                          fontFamily: theme.fonts.display,
                          fontSize: 14,
                          letterSpacing: 1.2,
                          color: TODAY_WORKOUT_THEME.colors.inverseForeground,
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('home:schedule.advance.cta', { weekday: advanceWeekday })}
                      </Text>
                    </Pressable>
                  ) : nextWorkoutLine && (
                    <View
                      style={{
                        alignSelf: 'flex-start',
                        marginTop: 20,
                        paddingVertical: 13,
                        paddingHorizontal: 18,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: TODAY_WORKOUT_THEME.colors.primaryBorderQuiet,
                        backgroundColor: TODAY_WORKOUT_THEME.colors.surfaceMuted,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <Icon name="calendar" size={14} color={TODAY_WORKOUT_THEME.colors.primaryEmphasis} />
                      <View>
                        <MonoLabel color={TODAY_WORKOUT_THEME.colors.textFaint}>
                          {t('home:schedule.nextWorkout.label').toUpperCase()}
                        </MonoLabel>
                        <Text
                          style={{
                            fontFamily: theme.fonts.uiBold,
                            fontSize: 13,
                            color: TODAY_WORKOUT_THEME.colors.textPrimary,
                            marginTop: 2,
                          }}
                        >
                          {nextWorkoutLine}
                        </Text>
                      </View>
                    </View>
                  )
                ) : (
                  <Pressable
                    onPress={onStart}
                    style={{
                      alignSelf: 'flex-start',
                      flexShrink: 1,
                      marginTop: 20,
                      paddingVertical: 15,
                      paddingHorizontal: workoutInProgress ? 16 : 26,
                      backgroundColor: TODAY_WORKOUT_THEME.colors.inverseSurface,
                      borderTopLeftRadius: 10,
                      borderTopRightRadius: 10,
                      borderBottomLeftRadius: 10,
                      borderBottomRightRadius: 0,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      shadowColor: TODAY_WORKOUT_THEME.colors.inverseShadow,
                      shadowOpacity: 0.16,
                      shadowRadius: 20,
                      shadowOffset: { width: 0, height: 10 },
                      elevation: 8,
                      ...(workoutInProgress ? {
                        backgroundColor: TODAY_WORKOUT_THEME.colors.primary,
                        shadowColor: TODAY_WORKOUT_THEME.colors.primary,
                      } : {}),
                    }}
                  >
                    {workoutInProgress ? (
                      <Icon
                        name="arrow-right"
                        size={13}
                        color={TODAY_WORKOUT_THEME.colors.primaryForeground}
                      />
                    ) : (
                      <Icon
                        name="play"
                        size={13}
                        color={TODAY_WORKOUT_THEME.colors.inverseForeground}
                      />
                    )}
                    <Text
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        fontFamily: theme.fonts.display,
                        fontSize: workoutInProgress ? 13 : 15,
                        letterSpacing: 1.5,
                        color: TODAY_WORKOUT_THEME.colors.inverseForeground,
                        textTransform: 'uppercase',
                        ...(workoutInProgress ? {
                          color: TODAY_WORKOUT_THEME.colors.primaryForeground,
                        } : {}),
                      }}
                    >
                      {t(workoutInProgress
                        ? 'home:activeWorkout.return'
                        : prescription.status === 'SUCCESS'
                          ? 'home:todayCard.start'
                          : 'home:todayCard.review')}
                    </Text>
                  </Pressable>
                )}

                {showBodyMuscleMap && (
                  <BodyMuscleMap
                    primaryMuscles={sessionMuscles.primary}
                    secondaryMuscles={sessionMuscles.secondary}
                    activeColor={TODAY_WORKOUT_THEME.colors.primaryEmphasis}
                    baseColor={TODAY_WORKOUT_THEME.colors.textFaint}
                    outlineColor={TODAY_WORKOUT_THEME.colors.border}
                    size={bodyMuscleMapSize}
                  />
                )}
              </View>
            </LinearGradient>
          </View>

          {/* Below the Today card, in "hoje → progresso → semana →
              histórico → próximos" order. Each section is a real projection of state
              Home (or AppShell) already holds — no new claims, no fabricated
              numbers — and is simply omitted while its data isn't loaded yet
              instead of showing a fake skeleton (docs task §11/§12). */}
          <ProgramProgressStrip viewModel={evolutionViewModel} onPress={onOpenEvolution} />

          {weekOverview ? (
            <View style={{ marginTop: 4 }}>
              <WeeklyOverview overview={weekOverview} />
            </View>
          ) : null}

          {frequencyWindow && onFrequencyPrev && onFrequencyNext ? (
            <View style={{ marginTop: 4, marginBottom: 8 }}>
              <FrequencyHeatmap
                window={frequencyWindow}
                loading={Boolean(frequencyLoading)}
                canGoNext={Boolean(frequencyCanGoNext)}
                onPrev={onFrequencyPrev}
                onNext={onFrequencyNext}
              />
            </View>
          ) : null}

          {/* Last section, after calendário/frequência: what comes NEXT.
              Tapping a row only ever opens its details — starting a session
              stays exclusively with the Today card + Schedule Engine. */}
          <UpcomingWorkouts workouts={upcomingWorkouts} onSelect={setSelectedUpcoming} />
        </ScrollView>
      </SafeAreaView>

      <UpcomingWorkoutDetailModal
        workout={selectedUpcoming}
        plan={prescription.status === 'SUCCESS' ? prescription.plan : null}
        onClose={() => setSelectedUpcoming(null)}
      />

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
    </ScreenBg>
  );
}
