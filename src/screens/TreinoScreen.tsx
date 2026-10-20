import { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Display, MonoLabel } from '../components/ui/Display';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useAuth } from '../state/AuthContext';
import { TreinoWeekStrip } from '../components/treino/TreinoWeekStrip';
import { TreinoTodayBlock, type TreinoTodayBlockMetric, type TreinoTodayBlockMuscleItem } from '../components/treino/TreinoTodayBlock';
import { TreinoExerciseList, type TreinoExerciseListItem } from '../components/treino/TreinoExerciseList';
import { TreinoUpcomingList, type TreinoUpcomingListItem } from '../components/treino/TreinoUpcomingList';
import { EvolutionTicker } from '../components/evolution/EvolutionTicker';
import { useTheme } from '../theme';
import { localDateInTimezone, weekdayOfLocalDate } from '../scheduleEngine';
import type { Sex } from '../state/AppState';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import { treinoCardSession } from './treinoCardSession';
import { completedTodayNextLabel } from './completedTodayNote';
import { buildUpcomingWorkouts, type UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import { buildTreinoWeekStrip } from '../home/treinoWeekStrip';
import { estimateSessionMinutes } from '../home/sessionDuration';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { TreinoWorkoutDetailSheet } from './TreinoWorkoutDetailSheet';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { logWarn } from '../lib/logger';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { ScheduleConfig, ScheduleResolution } from '../scheduleEngine/types';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { WeekOverviewViewModel } from '../home/weekOverview';
import type { AdvancedWorkoutTarget } from '../scheduleEngine/advanceWorkout';

export type RepositionOutcome = 'OK' | 'BLOCKED_IN_PROGRESS' | 'ALREADY_COMPLETED_TODAY' | 'ERROR';

/**
 * TREINO hub (docs §Nova tela TREINO). The Schedule Engine's own resolution
 * is the only source for "what's next" — this screen never recomputes or
 * guesses it, only renders `resolution`/`plan.sessions` and forwards intent
 * (start / reposition / edit agenda) to callbacks the caller (`AppShell`)
 * wires to the real authoritative flows.
 */
export function TreinoScreen({
  sex,
  plan,
  resolution,
  completedTodaySessionIndex,
  scheduleConfig,
  workoutInProgress,
  startPending,
  onStart,
  onOpenAgendaEditor,
  onReposition,
  evolutionViewModel,
  weekOverview,
  advanceWorkoutTarget = null,
  onAdvanceWorkout,
  pilotEnrolled = false,
}: {
  sex: Sex;
  plan: FinalWorkoutPlan;
  resolution: ScheduleResolution;
  completedTodaySessionIndex: number | null;
  scheduleConfig: ScheduleConfig | null;
  workoutInProgress: boolean;
  startPending: boolean;
  onStart: () => void;
  onOpenAgendaEditor: () => void;
  onReposition: (targetSessionIndex: number) => Promise<RepositionOutcome>;
  evolutionViewModel: EvolutionViewModel;
  weekOverview: WeekOverviewViewModel | null;
  /** Same two inputs Home's Today card gets — see `canAdvanceWorkout` below. */
  advanceWorkoutTarget?: AdvancedWorkoutTarget | null;
  onAdvanceWorkout?: () => void;
  /**
   * Controlled pilot of the new training architecture. Selects the
   * forward-looking daily-limit copy ("volte amanhã"), which is only true
   * when any day is trainable. A non-enrolled account keeps the neutral
   * legacy sentence, because its next session may well be days away.
   */
  pilotEnrolled?: boolean;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('treino');
  const { t: tHome } = useTranslation('home');
  const { t: tWorkout } = useTranslation('workout');
  const tLoose = tHome as unknown as LooseTranslate;
  // Same avatar as Home's header (`src/screens/HomeScreen.tsx`) — real
  // photo/initials, never a fixed "AJ" placeholder.
  const { user, profile } = useAuth();
  const headerDisplayName = profile?.profile.name || user?.displayName || '';
  const [detailWorkout, setDetailWorkout] = useState<UpcomingWorkoutViewModel | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const bodyMuscleMapSize = windowWidth < 360 ? 84 : 104;
  const frontOffsetX = windowWidth < 360 ? 14 : 18;

  const nextIndex = effectiveNextSessionIndex(resolution);
  const displayedSession = treinoCardSession(plan.sessions, resolution, completedTodaySessionIndex);
  const rawDisplayedSessionIndex = resolution.status === 'TODAY_COMPLETED' ? completedTodaySessionIndex : nextIndex;
  // Only an index that actually resolves to the session named above — otherwise
  // `workoutExercisesFromPlan`'s own `?? plan.sessions[0]` fallback would list a
  // DIFFERENT session's exercises under this session's title. `treinoCardSession`
  // resolves an out-of-range cursor to null, so the two must agree here.
  const displayedSessionIndex = rawDisplayedSessionIndex != null && plan.sessions[rawDisplayedSessionIndex]
    ? rawDisplayedSessionIndex
    : null;
  if (rawDisplayedSessionIndex != null && displayedSessionIndex == null) {
    // Degrading to the empty block is safe but indistinguishable from a real
    // rest day, so the stale cursor would otherwise be invisible in production.
    // The cursor itself is persisted unclamped (`resolver.ts`'s SESSION_READY
    // branch has no modulo), so this is the only place it surfaces.
    logWarn('treino', 'displayed_session_index_out_of_range', {
      sessionIndex: rawDisplayedSessionIndex,
      sessionCount: plan.sessions.length,
      status: resolution.status,
    });
  }
  // Same actionable-CTA set as Home's own "todayCard" (docs §Consistência com
  // Meu Plano): MISSED_SESSION_DECISION_REQUIRED keeps the normal "Iniciar
  // treino" affordance — the decision itself is only asked once the user
  // taps it (`requestStartWorkout`'s own branch), never surfaced here as a
  // second, competing flow.
  const canStartNow = workoutInProgress
    || resolution.status === 'SESSION_READY'
    || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED';
  const isFlexible = (scheduleConfig?.scheduleMode ?? 'fixed') === 'flexible';

  const statusCopyKey =
    resolution.status === 'REST_DAY' ? 'restDay' :
    resolution.status === 'ACTIVE_RECOVERY_DAY' ? 'activeRecovery' :
    resolution.status === 'TODAY_COMPLETED' ? (pilotEnrolled ? 'completedTodayFree' : 'completedToday') :
    resolution.status === 'SCHEDULE_SETUP_REQUIRED' ? 'setupRequired' :
    resolution.status === 'MISSED_SESSION_DECISION_REQUIRED' ? 'missedDecision' :
    null;

  const exerciseCount = displayedSession?.exercises.length ?? 0;
  const setCount = displayedSession?.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 1), 0) ?? 0;
  const sessionMuscles = deriveSessionMuscles(displayedSession?.exercises.map((exercise) => exercise.exerciseId) ?? []);
  const showBodyMap = sessionMuscles.primary.length > 0;
  const todayLocalDate = localDateInTimezone(new Date(), scheduleConfig?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const nextWorkoutDate = 'nextWorkoutDate' in resolution ? resolution.nextWorkoutDate : null;
  // Same "{weekday} · {day} {month}" template Home's own header uses
  // (`home:meta.todayLine`) — standardized across Home/Treino/Dieta instead
  // of each screen formatting the date with its own raw `Intl` call.
  const headerDateLabel = tHome('meta.todayLine', {
    weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    day: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { day: '2-digit', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    month: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
  }).toUpperCase();

  const trainingDays = scheduleConfig?.trainingDays ?? [];
  const upcoming = buildUpcomingWorkouts({
    todayLocalDate,
    scheduleMode: scheduleConfig?.scheduleMode,
    trainingDays,
    sessions: plan.sessions,
    resolution,
    limit: 3,
  });

  // "TREINO DE HOJE" vs "PRÓXIMO · {DIA}" (spec §3.2.C). TODAY_COMPLETED
  // still names the finished session as "hoje" — it already happened today.
  const showsTodaySession = workoutInProgress
    || resolution.status === 'SESSION_READY'
    || resolution.status === 'MISSED_SESSION_DECISION_REQUIRED'
    || resolution.status === 'TODAY_COMPLETED';
  const nextWeekdayLabel = !showsTodaySession && nextWorkoutDate
    ? tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate(nextWorkoutDate)}`)
    : null;
  const todayBlockKicker = showsTodaySession
    ? t('todayBlock.kickerToday')
    : nextWeekdayLabel
      ? t('todayBlock.kickerNext', { weekday: nextWeekdayLabel })
      : null;
  const sessionLetter = displayedSessionIndex != null ? String.fromCharCode(65 + displayedSessionIndex) : null;
  const todayBlockSessionLabel = sessionLetter ? t('todayBlock.sessionLabel', { letter: sessionLetter }) : null;
  const todayBlockTitle = displayedSession
    ? resolveSessionDisplayName(tLoose, displayedSession.name, displayedSession.type, displayedSession.displayName)
    : statusCopyKey
      ? tHome(`schedule.${statusCopyKey}.title`)
      : '';

  const muscleListItems: TreinoTodayBlockMuscleItem[] = showBodyMap
    ? [
        ...sessionMuscles.primary.map((id) => ({ id, name: tWorkout(`muscleGroups.${id}`) })),
        ...sessionMuscles.secondary.map((id) => ({ id, name: tWorkout(`muscleGroups.${id}`) })),
      ].slice(0, 5)
    : [];

  const sessionMinutes = displayedSession ? estimateSessionMinutes(displayedSession) : 0;
  const metrics: TreinoTodayBlockMetric[] = displayedSession
    ? [
        {
          value: sessionMinutes > 0 ? String(sessionMinutes) : '—',
          unit: sessionMinutes > 0 ? t('todayBlock.metrics.durationUnit') : undefined,
          label: t('todayBlock.metrics.duration'),
        },
        { value: String(exerciseCount), label: t('todayBlock.metrics.exercises') },
        { value: String(setCount), label: t('todayBlock.metrics.sets') },
      ]
    : [];

  const ctaLabel = workoutInProgress ? t('currentWorkout.continue') : tHome('todayCard.start');

  // Today's session is done: the start CTA's slot becomes a blocked button
  // plus a note naming the next workout. `TODAY_COMPLETED` already excludes
  // `workoutInProgress` (which would have made `canStartNow` true above), so
  // the two never render together.
  const showCompletedToday = !canStartNow && resolution.status === 'TODAY_COMPLETED';
  const completedNextLabel = showCompletedToday
    ? completedTodayNextLabel({
        nextWorkoutDate,
        todayLocalDate,
        todayLabel: t('agenda.today'),
        tomorrowLabel: t('agenda.tomorrow'),
        locale: i18n.resolvedLanguage ?? i18n.language,
      })
    : null;
  const completedNote = showCompletedToday
    ? completedNextLabel
      ? t('completed.note', { when: completedNextLabel })
      : t('completed.noteNoNext')
    : null;

  // "Adiantar treino de {dia}", the same affordance Home's Today card offers
  // in this very slot. Identical gate to Home's `canAdvanceWorkout`: whether
  // advancing is on offer at all is `advancedWorkoutTarget`'s call in
  // `AppShell` — this screen only renders it and forwards the intent, and
  // `onAdvanceWorkout` opens the shared confirmation rather than advancing.
  const canAdvanceWorkout = !workoutInProgress
    && resolution.status === 'REST_DAY'
    && advanceWorkoutTarget != null
    && onAdvanceWorkout != null;
  const advanceLabel = canAdvanceWorkout
    ? tHome('schedule.advance.cta', {
        weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'long', timeZone: 'UTC' })
          .format(new Date(`${advanceWorkoutTarget.scheduledLocalDate}T12:00:00Z`)),
      })
    : null;

  // Blocked day with nothing to act on: name the next workout, the same row
  // (same `home:schedule.nextWorkout.*` copy, same weekday/session inputs)
  // Home's Today card falls back to — otherwise the slot renders nothing.
  const nextSession = nextWorkoutDate != null && nextIndex != null
    ? plan.sessions[nextIndex] ?? null
    : null;
  const nextWorkoutValue = !canStartNow && !showCompletedToday && nextSession && nextWorkoutDate
    ? tHome('schedule.nextWorkout.value', {
        weekday: tLoose(`quiz:trainingDays.options.${weekdayOfLocalDate(nextWorkoutDate)}`),
        session: resolveSessionDisplayName(tLoose, nextSession.name, nextSession.type),
      })
    : null;

  const exerciseListItems: TreinoExerciseListItem[] = useMemo(() => {
    if (displayedSessionIndex == null) return [];
    try {
      return workoutExercisesFromPlan(plan, i18n.language, displayedSessionIndex)
        .map((exercise) => ({ id: exercise.id, name: exercise.name }));
    } catch (error) {
      logWarn('treino', 'today_exercises_unavailable', { sessionIndex: displayedSessionIndex, error });
      return [];
    }
  }, [plan, displayedSessionIndex, i18n.language]);

  const weekStripDays = weekOverview
    ? buildTreinoWeekStrip({
        overview: weekOverview,
        todayLocalDate,
        scheduleMode: scheduleConfig?.scheduleMode,
        trainingDays,
        sessions: plan.sessions,
        resolution,
        nextSessionIndex: nextIndex,
      })
    : [];
  const weekSummaryLabel = weekOverview
    ? tHome('activity.week.summary', { completed: weekOverview.completedCount, scheduled: weekOverview.scheduledCount })
    : '';

  const upcomingItems: TreinoUpcomingListItem[] = upcoming.map((workout) => {
    const a11yWeekday = workout.flexible
      ? tHome('upcoming.flexible')
      : tLoose(`quiz:trainingDays.options.${workout.weekday}`);
    const dayLabel = workout.flexible
      ? String.fromCharCode(65 + workout.sessionIndex)
      : `${t(`agenda.weekday.${workout.weekday}`)} ${workout.localDate.slice(8, 10)}`;
    const sessionLabel = resolveSessionDisplayName(tLoose, workout.sessionName, workout.sessionType, workout.sessionDisplayName);
    const meta = workout.estimatedMinutes > 0
      ? tHome('upcoming.meta', { minutes: workout.estimatedMinutes, count: workout.exerciseCount })
      : tHome('upcoming.metaNoEstimate', { count: workout.exerciseCount });
    return {
      key: `${workout.localDate}:${workout.sessionIndex}`,
      dayLabel,
      title: sessionLabel,
      meta,
      accessibilityLabel: tHome('upcoming.open', { weekday: a11yWeekday, session: sessionLabel }),
      onPress: () => setDetailWorkout(workout),
    };
  });

  return (
    <ScreenBg>
      {/*
        `edges={['top']}` only — this screen's content area is a flex
        SIBLING of AppShell's tab bar (same column, tab bar sized by its own
        content, this view sized by `flex: 1` to exactly what's left above
        it), not rendered behind it. A `'bottom'` edge here reserves the
        device's home-indicator inset a second time — already spent once
        inside the tab bar's own `SafeAreaView edges={['bottom']}` — which
        pushed this screen's content away from the tab bar with dead empty
        space. Mirrors the already-correct `src/screens/HomeScreen.tsx`.
      */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/*
          `style={{ flex: 1 }}` on the ScrollView: without it, the
          ScrollView sizes to its own content instead of the space `flex: 1`
          above leaves for it, and `ScreenBg`'s `overflow: 'hidden'` (a
          shared component, out of scope to change here) then clips
          whatever doesn't fit instead of it being scrollable — the exact
          "elementos cortados" symptom. 24, not 112 — plain bottom breathing
          room for the last card, not a guess at the tab bar's height.
        */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Same header geometry as Home's (`src/screens/HomeScreen.tsx`) —
              22px gutter, 50px total top offset, 12px bottom gap before the
              ticker — so every tab's header/ticker block lines up at an
              identical height. */}
          <View style={{ paddingHorizontal: 22, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <MonoLabel color={theme.colors.textFaint}>{headerDateLabel}</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }}>{t('header.title')}.</Display>
            </View>
            <ProfileAvatar
              displayName={headerDisplayName}
              photoURL={profile?.profile.photoURL}
              photoVersion={profile?.profile.photoVersion}
              size={46}
            />
          </View>

          <View style={{ marginTop: 4, marginBottom: 18 }}>
            <EvolutionTicker viewModel={evolutionViewModel} />
          </View>

          {weekOverview && (
            <View style={{ marginTop: 24 }}>
              <TreinoWeekStrip
                days={weekStripDays}
                disabled={workoutInProgress}
                weekSummaryLabel={weekSummaryLabel}
                onPress={onOpenAgendaEditor}
              />
            </View>
          )}

          <TreinoTodayBlock
            kicker={todayBlockKicker}
            sessionLabel={todayBlockSessionLabel}
            title={todayBlockTitle}
            muscles={muscleListItems}
            sex={sex}
            primaryMuscles={sessionMuscles.primary}
            secondaryMuscles={sessionMuscles.secondary}
            showBodyMap={showBodyMap}
            bodyMapSize={bodyMuscleMapSize}
            frontOffsetX={frontOffsetX}
            metrics={metrics}
            ctaVisible={canStartNow}
            ctaLabel={ctaLabel}
            ctaDisabled={startPending}
            onPressCta={onStart}
            completedLabel={showCompletedToday ? t('completed.button') : null}
            completedNote={completedNote}
            advanceLabel={advanceLabel}
            onPressAdvance={canAdvanceWorkout ? onAdvanceWorkout : null}
            nextWorkoutLabel={nextWorkoutValue ? tHome('schedule.nextWorkout.label') : null}
            nextWorkoutValue={nextWorkoutValue}
          />

          <TreinoExerciseList
            title={t('exercises.title')}
            exercises={exerciseListItems}
            showAllLabel={(count) => t('exercises.showAll', { count })}
            showLessLabel={t('exercises.showLess')}
          />

          <TreinoUpcomingList
            title={isFlexible ? t('upcoming.titleFlexible') : tHome('upcoming.title')}
            items={upcomingItems}
          />
        </ScrollView>
      </SafeAreaView>

      {detailWorkout && (
        <TreinoWorkoutDetailSheet
          workout={detailWorkout}
          plan={plan}
          nextSessionIndex={nextIndex}
          completedTodaySessionIndex={completedTodaySessionIndex}
          workoutInProgress={workoutInProgress}
          onClose={() => setDetailWorkout(null)}
          onStart={onStart}
          onReposition={onReposition}
        />
      )}
    </ScreenBg>
  );
}
