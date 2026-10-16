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
    resolution.status === 'TODAY_COMPLETED' ? 'completedToday' :
    resolution.status === 'SCHEDULE_SETUP_REQUIRED' ? 'setupRequired' :
    resolution.status === 'MISSED_SESSION_DECISION_REQUIRED' ? 'missedDecision' :
    null;

  const exerciseCount = displayedSession?.exercises.length ?? 0;
  const setCount = displayedSession?.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? 1), 0) ?? 0;
  const sessionMuscles = deriveSessionMuscles(displayedSession?.exercises.map((exercise) => exercise.exerciseId) ?? []);
  const showBodyMap = sessionMuscles.primary.length > 0;
  const todayLocalDate = localDateInTimezone(new Date(), scheduleConfig?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const nextWorkoutDate = 'nextWorkoutDate' in resolution ? resolution.nextWorkoutDate : null;
  const headerDateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${todayLocalDate}T12:00:00Z`))
    .toUpperCase();

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
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 112 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Same header geometry as Home's (`src/screens/HomeScreen.tsx`) —
              22px gutter, 50px total top offset, 12px bottom gap before the
              ticker — so every tab's header/ticker block lines up at an
              identical height. */}
          <View style={{ paddingHorizontal: 22, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View>
              <MonoLabel color={theme.colors.textFaint}>{headerDateLabel}</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }}>{t('header.title')}</Display>
            </View>
            <ProfileAvatar
              displayName={headerDisplayName}
              photoURL={profile?.profile.photoURL}
              photoVersion={profile?.profile.photoVersion}
              size={46}
            />
          </View>

          <View style={{ marginTop: 22, marginBottom: 18 }}>
            <EvolutionTicker viewModel={evolutionViewModel} />
          </View>

          {weekOverview && (
            <View style={{ marginTop: 24 }}>
              <TreinoWeekStrip
                days={weekStripDays}
                dimmed={isFlexible || workoutInProgress}
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
