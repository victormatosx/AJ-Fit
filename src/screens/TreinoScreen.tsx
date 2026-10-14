import { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/ui/Icon';
import { BodyMuscleMap } from '../components/fitness/BodyMuscleMap';
import { HudCorners } from '../components/ui/Card';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { ScreenBg } from '../components/ui/ScreenBg';
import { useAuth } from '../state/AuthContext';
import { WeeklyOverview } from '../components/home/WeeklyOverview';
import { EvolutionTicker } from '../components/evolution/EvolutionTicker';
import { darkTheme, useTheme } from '../theme';
import { localDateInTimezone } from '../scheduleEngine';
import type { Sex } from '../state/AppState';
import { deriveSessionMuscles } from '../lib/sessionMuscles';
import { effectiveNextSessionIndex } from '../scheduleEngine/effectiveNextSessionIndex';
import { treinoCardSession } from './treinoCardSession';
import { buildUpcomingWorkouts, type UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import { TreinoWorkoutDetailSheet } from './TreinoWorkoutDetailSheet';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { ScheduleConfig, ScheduleResolution } from '../scheduleEngine/types';
import type { EvolutionViewModel } from '../workoutEvolution/types';
import type { WeekOverviewViewModel } from '../home/weekOverview';

// Product invariant shared with Home: the Today Workout poster keeps the
// official Dark art direction in both app themes.
const TODAY_WORKOUT_THEME = darkTheme;

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
  const tLoose = tHome as unknown as LooseTranslate;
  // Same avatar as Home's header (`src/screens/HomeScreen.tsx`) — real
  // photo/initials, never a fixed "AJ" placeholder.
  const { user, profile } = useAuth();
  const headerDisplayName = profile?.profile.name || user?.displayName || '';
  const [detailWorkout, setDetailWorkout] = useState<UpcomingWorkoutViewModel | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  // Same breakpoint/value Home's own Today poster uses for its BodyMuscleMap.
  const bodyMuscleMapSize = windowWidth < 360 ? 46 : 58;

  const nextIndex = effectiveNextSessionIndex(resolution);
  const displayedSession = treinoCardSession(plan.sessions, resolution, completedTodaySessionIndex);
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
  const dateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${nextWorkoutDate ?? todayLocalDate}T12:00:00Z`));
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

          {/* TODAY POSTER — pixel-identical to Home's own Today card (same
              forced Dark art direction, gradient, radius and CTA button). */}
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
                <Slash accentColor={TODAY_WORKOUT_THEME.colors.primaryEmphasis} textColor={TODAY_WORKOUT_THEME.colors.textFaint}>
                  {(workoutInProgress ? t('hero.inProgress') : statusCopyKey ? tHome(`schedule.${statusCopyKey}.title`) : tHome('todayCard.kicker')).toUpperCase()}
                </Slash>
                <Display size={38} color={TODAY_WORKOUT_THEME.colors.textPrimary} style={{ marginTop: 12 }}>
                  {(displayedSession
                    ? resolveSessionDisplayName(tLoose, displayedSession.name, displayedSession.type, displayedSession.displayName)
                    : tHome(`schedule.${statusCopyKey ?? 'setupRequired'}.title`)
                  ).toUpperCase()}
                </Display>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10.5, color: TODAY_WORKOUT_THEME.colors.textSecondary, letterSpacing: 1 }}>
                    {(displayedSession
                      ? tHome('todayCard.sessionMeta', { exercises: exerciseCount, sets: setCount })
                      : statusCopyKey ? tHome(`schedule.${statusCopyKey}.body`) : ''
                    ).toUpperCase()}
                  </Text>
                </View>
                <MonoLabel color={TODAY_WORKOUT_THEME.colors.primaryEmphasis} size={9} style={{ marginTop: 10 }}>{dateLabel}</MonoLabel>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                {canStartNow ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: startPending }}
                    disabled={startPending}
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
                      opacity: startPending ? 0.6 : 1,
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
                    <Icon
                      name={workoutInProgress ? 'arrow-right' : 'play'}
                      size={13}
                      color={workoutInProgress ? TODAY_WORKOUT_THEME.colors.primaryForeground : TODAY_WORKOUT_THEME.colors.inverseForeground}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        flexShrink: 1,
                        fontFamily: theme.fonts.display,
                        fontSize: workoutInProgress ? 13 : 15,
                        letterSpacing: 1.5,
                        color: TODAY_WORKOUT_THEME.colors.inverseForeground,
                        textTransform: 'uppercase',
                        ...(workoutInProgress ? { color: TODAY_WORKOUT_THEME.colors.primaryForeground } : {}),
                      }}
                    >
                      {workoutInProgress ? t('currentWorkout.continue') : tHome('todayCard.start')}
                    </Text>
                  </Pressable>
                ) : <View />}

                {showBodyMap && (
                  <BodyMuscleMap
                    sex={sex}
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

          <View style={{ marginTop: 28 }}>
            <View style={{ paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Slash>{isFlexible ? t('agenda.flexibleLabel') : t('agenda.title')}</Slash>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: workoutInProgress }}
                disabled={workoutInProgress}
                onPress={onOpenAgendaEditor}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, opacity: workoutInProgress ? 0.4 : 1 }}
              >
                <Icon name="calendar" size={12} color={theme.colors.primaryEmphasis} />
                <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {t('agenda.edit')}
                </Text>
              </Pressable>
            </View>

            {/* Same "Esta semana" visual Home uses — real per-day completion
                status from the Schedule Engine, not a trainingDays-only grid. */}
            {weekOverview && <WeeklyOverview overview={weekOverview} />}
          </View>

          {upcoming.length > 0 && (
            <View style={{ paddingHorizontal: 22, marginTop: 36 }}>
              <Slash style={{ marginBottom: 16 }}>{isFlexible ? t('upcoming.titleFlexible') : tHome('upcoming.title')}</Slash>
              {upcoming.map((workout) => {
                const weekdayLabel = workout.flexible
                  ? tHome('upcoming.flexible').toUpperCase()
                  : tLoose(`quiz:trainingDays.options.${workout.weekday}`).toUpperCase();
                const sessionLabel = resolveSessionDisplayName(tLoose, workout.sessionName, workout.sessionType, workout.sessionDisplayName);
                const meta = workout.estimatedMinutes > 0
                  ? tHome('upcoming.meta', { minutes: workout.estimatedMinutes, count: workout.exerciseCount })
                  : tHome('upcoming.metaNoEstimate', { count: workout.exerciseCount });
                return (
                  <Pressable
                    key={`${workout.localDate}:${workout.sessionIndex}`}
                    accessibilityRole="button"
                    accessibilityLabel={tHome('upcoming.open', { weekday: weekdayLabel, session: sessionLabel })}
                    onPress={() => setDetailWorkout(workout)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      paddingVertical: 16, paddingHorizontal: 16,
                      borderRadius: theme.radii.xl, marginBottom: 10,
                      backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
                      borderWidth: 1, borderColor: theme.colors.cardBorder,
                    })}
                  >
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="clip"
                      style={{
                        width: workout.flexible ? 82 : 46,
                        fontFamily: theme.fonts.monoBold,
                        fontSize: 14,
                        letterSpacing: 1.2,
                        color: theme.colors.textFaint,
                      }}
                    >
                      {weekdayLabel}
                    </Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: theme.fonts.uiBold, fontSize: 16.5, color: theme.colors.textPrimary }}>
                        {sessionLabel}
                      </Text>
                      <Text numberOfLines={1} style={{ fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.textFaint, marginTop: 4 }}>
                        {meta}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={theme.colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          )}
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
