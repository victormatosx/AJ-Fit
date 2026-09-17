import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { workoutExercisesFromPlan } from '../../screens/workoutScreenPlan';
import { resolveSessionDisplayName, type LooseTranslate } from '../../workoutPrescription/sessionPresentation';
import { logWarn } from '../../lib/logger';
import type { FinalWorkoutPlan } from '../../workoutPrescription/types';
import type { UpcomingWorkoutViewModel } from '../../home/upcomingWorkouts';

/**
 * Read-only detail of a session that is scheduled but NOT startable today —
 * opened from the "próximos treinos" list on Home. It deliberately carries
 * no start/resume affordance: the Schedule Engine alone decides what may be
 * started, and only today's session ever can be (docs/workout-lifecycle/
 * 03_SCHEDULE_ENGINE.md §Bloqueio real).
 *
 * The exercise list is the SAME projection Meu Plano and the live workout
 * read (`workoutExercisesFromPlan`), so the three can never disagree about
 * what a session contains. It shows the canonical prescription — permanent
 * manual substitutions are applied when the session is actually executed,
 * exactly like every other forward-looking surface.
 */
export function UpcomingWorkoutDetailModal({
  workout,
  plan,
  onClose,
}: {
  workout: UpcomingWorkoutViewModel | null;
  plan: FinalWorkoutPlan | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['home', 'quiz', 'workout']);
  const { theme } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const tLoose = t as unknown as LooseTranslate;
  const locale = i18n.resolvedLanguage ?? i18n.language;

  // `workoutExercisesFromPlan` throws on a catalog id it can't resolve. On
  // Meu Plano that is the whole screen's content; here it is one optional
  // preview on Home, so a lookup miss degrades to the "unavailable" note
  // below instead of taking Home down with it.
  const exercises = useMemo(() => {
    if (!plan || !workout) return null;
    try {
      return workoutExercisesFromPlan(plan, i18n.language, workout.sessionIndex);
    } catch (error) {
      logWarn('home', 'upcoming_workout_exercises_unavailable', {
        sessionIndex: workout.sessionIndex,
        error,
      });
      return null;
    }
  }, [plan, workout, i18n.language]);

  const sessionLabel = workout
    ? resolveSessionDisplayName(tLoose, workout.sessionName, workout.sessionType, workout.sessionDisplayName)
    : '';
  const weekdayLabel = workout
    ? workout.flexible
      ? t('home:upcoming.flexible')
      : tLoose(`quiz:trainingDays.options.${workout.weekday}`)
    : '';
  const dateLabel = workout
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
        .format(new Date(`${workout.localDate}T12:00:00`))
    : '';

  return (
    <Modal
      visible={workout !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home:upcoming.detail.close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            maxHeight: windowHeight * 0.82,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden',
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.sheetBorder,
            backgroundColor: theme.colors.sheetBackground,
          }}
        >
          {/* header */}
          <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Slash>{t('home:upcoming.detail.kicker')}</Slash>
                <Display size={26} style={{ marginTop: 10 }} numberOfLines={2}>
                  {sessionLabel.toUpperCase()}
                </Display>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('home:upcoming.detail.close')}
                onPress={onClose}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.colors.controlBorder,
                  backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.controlBackground,
                })}
              >
                <Icon name="x" size={15} color={theme.colors.textSecondary} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="calendar" size={13} color={theme.colors.primaryEmphasis} />
                <MonoLabel color={theme.colors.textSecondary}>
                  {workout?.flexible
                    ? t('home:upcoming.detail.flexibleAvailable')
                    : t('home:upcoming.detail.scheduledFor', { weekday: weekdayLabel, date: dateLabel })}
                </MonoLabel>
              </View>
              {workout && workout.estimatedMinutes > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="timer" size={13} color={theme.colors.primaryEmphasis} />
                  <MonoLabel color={theme.colors.textSecondary}>
                    {t('home:upcoming.meta', {
                      minutes: workout.estimatedMinutes,
                      count: workout.exerciseCount,
                    })}
                  </MonoLabel>
                </View>
              ) : workout ? (
                <MonoLabel color={theme.colors.textSecondary}>
                  {t('home:upcoming.metaNoEstimate', { count: workout.exerciseCount })}
                </MonoLabel>
              ) : null}
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: theme.colors.sheetDivider }} />

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 34 }}
            showsVerticalScrollIndicator={false}
          >
            <MonoLabel style={{ marginBottom: 6 }}>{t('home:upcoming.detail.exercises')}</MonoLabel>

            {exercises === null || exercises.length === 0 ? (
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 13,
                  lineHeight: 19,
                  color: theme.colors.textMuted,
                  marginTop: 10,
                }}
              >
                {t('home:upcoming.detail.unavailable')}
              </Text>
            ) : (
              exercises.map((exercise, index) => {
                const reps = exercise.sets[0]?.r ?? '';
                const isDuration = /s$|min$/i.test(reps.trim());
                return (
                  <View
                    key={`${exercise.id}-${index}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.divider,
                    }}
                  >
                    <Text
                      style={{
                        width: 20,
                        fontFamily: theme.fonts.mono,
                        fontSize: 11,
                        color: theme.colors.textFaint,
                      }}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={2}
                        style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}
                      >
                        {exercise.name}
                      </Text>
                      {exercise.target ? (
                        <Text
                          style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint, marginTop: 2 }}
                        >
                          {exercise.target}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 12.5, color: theme.colors.textSecondary }}>
                        {t(isDuration ? 'home:upcoming.detail.setsDuration' : 'home:upcoming.detail.setsReps', {
                          sets: exercise.sets.length,
                          reps,
                          duration: reps,
                        })}
                      </Text>
                      {exercise.rest > 0 ? (
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11, color: theme.colors.textFaint, marginTop: 1 }}>
                          {t('home:upcoming.detail.rest', { seconds: exercise.rest })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}

            {workout && workout.estimatedMinutes > 0 ? (
              <Text
                style={{
                  fontFamily: theme.fonts.ui,
                  fontSize: 11.5,
                  lineHeight: 17,
                  color: theme.colors.textFaint,
                  marginTop: 18,
                }}
              >
                {t('home:upcoming.detail.estimateNote')}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
