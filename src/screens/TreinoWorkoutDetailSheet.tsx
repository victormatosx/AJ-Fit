import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { useTheme } from '../theme';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { resolveSessionDisplayName, type LooseTranslate } from '../workoutPrescription/sessionPresentation';
import { logWarn } from '../lib/logger';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import type { RepositionOutcome } from './TreinoScreen';

/**
 * Detail sheet opened from the Treino screen's "Próximos treinos" list
 * (docs §Nova tela TREINO, seção 3.1). The exercise list is the SAME
 * projection Meu Plano/Home read (`workoutExercisesFromPlan`) — never a
 * second source of truth. "Fazer agora" reuses the exact reposition/start
 * callbacks the hub already wires to the Schedule Engine
 * (`onReposition`/`onStart`); this component decides nothing on its own
 * about what may start, it only sequences two already-authoritative calls.
 */
export function TreinoWorkoutDetailSheet({
  workout,
  plan,
  nextSessionIndex,
  completedTodaySessionIndex,
  workoutInProgress,
  onClose,
  onStart,
  onReposition,
}: {
  workout: UpcomingWorkoutViewModel;
  plan: FinalWorkoutPlan;
  nextSessionIndex: number | null;
  completedTodaySessionIndex: number | null;
  workoutInProgress: boolean;
  onClose: () => void;
  onStart: () => void;
  onReposition: (targetSessionIndex: number) => Promise<RepositionOutcome>;
}) {
  const { t, i18n } = useTranslation(['treino', 'home', 'quiz', 'workout']);
  const { theme } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const tLoose = t as unknown as LooseTranslate;
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<RepositionOutcome | null>(null);

  const isNext = workout.sessionIndex === nextSessionIndex;
  const alreadyDoneToday = workout.sessionIndex === completedTodaySessionIndex;

  const exercises = useMemo(() => {
    try {
      return workoutExercisesFromPlan(plan, i18n.language, workout.sessionIndex);
    } catch (error) {
      logWarn('treino', 'workout_detail_exercises_unavailable', { sessionIndex: workout.sessionIndex, error });
      return null;
    }
  }, [plan, workout.sessionIndex, i18n.language]);

  const sessionLabel = resolveSessionDisplayName(tLoose, workout.sessionName, workout.sessionType, workout.sessionDisplayName);
  const weekdayLabel = workout.flexible
    ? t('home:upcoming.flexible')
    : tLoose(`quiz:trainingDays.options.${workout.weekday}`);
  const dateLabel = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
    .format(new Date(`${workout.localDate}T12:00:00`));

  const blocked = workoutInProgress || alreadyDoneToday;

  const go = async () => {
    if (submitting || blocked) return;
    setErrorCode(null);
    if (isNext) {
      onClose();
      onStart();
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await onReposition(workout.sessionIndex);
      if (outcome === 'OK') {
        onClose();
        onStart();
      } else {
        setErrorCode(outcome);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const warning = workoutInProgress
    ? t('treino:changeWorkout.blockedInProgress')
    : alreadyDoneToday
      ? t('treino:changeWorkout.blockedCompletedToday')
      : errorCode === 'ALREADY_COMPLETED_TODAY'
        ? t('treino:changeWorkout.blockedCompletedToday')
        : errorCode === 'BLOCKED_IN_PROGRESS'
          ? t('treino:changeWorkout.blockedInProgress')
          : errorCode === 'ERROR'
            ? t('treino:changeWorkout.error')
            : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={submitting ? undefined : onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home:upcoming.detail.close')}
        onPress={submitting ? undefined : onClose}
        style={{ flex: 1, backgroundColor: theme.colors.overlayStrong, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            maxHeight: windowHeight * 0.74,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            overflow: 'hidden',
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.sheetBorder,
            backgroundColor: theme.colors.workoutSheetBackground,
          }}
        >
          {/* header */}
          <View style={{ paddingHorizontal: 24, paddingTop: 26, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: theme.colors.sheetDivider }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Slash>{t('home:upcoming.detail.kicker')}</Slash>
                <Display size={30} skew={false} style={{ marginTop: 12 }} numberOfLines={2}>
                  {sessionLabel}
                </Display>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('treino:detail.makeNowAccessibility')}
                  accessibilityState={{ disabled: submitting || blocked }}
                  disabled={submitting || blocked}
                  onPress={go}
                  style={({ pressed }) => ({
                    height: 38,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                    borderWidth: 1,
                    borderColor: theme.colors.primaryBorderActive,
                    backgroundColor: pressed ? theme.colors.primarySurfaceSubtle : 'transparent',
                    opacity: submitting || blocked ? 0.35 : 1,
                  })}
                >
                  {!submitting && <Icon name="play" size={10} color={theme.colors.primaryEmphasis} />}
                  <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.uiSemi, fontSize: 12.5 }}>
                    {submitting ? t('treino:agenda.saving') : t('treino:detail.makeNow')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('home:upcoming.detail.close')}
                  onPress={submitting ? undefined : onClose}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 38,
                    height: 38,
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
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="calendar" size={13} color={theme.colors.primaryEmphasis} />
                <MonoLabel color={theme.colors.textSecondary}>
                  {workout.flexible
                    ? t('home:upcoming.detail.flexibleAvailable')
                    : t('home:upcoming.detail.scheduledFor', { weekday: weekdayLabel, date: dateLabel })}
                </MonoLabel>
              </View>
              {workout.estimatedMinutes > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Icon name="timer" size={13} color={theme.colors.primaryEmphasis} />
                  <MonoLabel color={theme.colors.textSecondary}>
                    {t('home:upcoming.meta', { minutes: workout.estimatedMinutes, count: workout.exerciseCount })}
                  </MonoLabel>
                </View>
              ) : (
                <MonoLabel color={theme.colors.textSecondary}>
                  {t('home:upcoming.metaNoEstimate', { count: workout.exerciseCount })}
                </MonoLabel>
              )}
            </View>

            {warning && (
              <Text style={{ color: workoutInProgress ? theme.colors.warning : theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 12.5, marginTop: 14, lineHeight: 18 }}>
                {warning}
              </Text>
            )}
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 18, paddingBottom: 34 }} showsVerticalScrollIndicator={false}>
            <MonoLabel style={{ marginBottom: 6 }}>{t('home:upcoming.detail.exercises')}</MonoLabel>

            {exercises === null || exercises.length === 0 ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted, marginTop: 10 }}>
                {t('home:upcoming.detail.unavailable')}
              </Text>
            ) : (
              exercises.map((exercise, index) => {
                const reps = exercise.sets[0]?.r ?? '';
                const isDuration = /s$|min$/i.test(reps.trim());
                const muscleLabel = exercise.target
                  ? t(`workout:muscleGroups.${exercise.target}`, { defaultValue: exercise.target })
                  : null;
                return (
                  <View
                    key={`${exercise.id}-${index}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.divider,
                    }}
                  >
                    <Text style={{ width: 20, fontFamily: theme.fonts.mono, fontSize: 12, color: theme.colors.textFaint }}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={2} style={{ fontFamily: theme.fonts.uiBold, fontSize: 15.5, color: theme.colors.textPrimary }}>
                        {exercise.name}
                      </Text>
                      {muscleLabel ? (
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textFaint, marginTop: 3 }}>
                          {muscleLabel}
                        </Text>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                      <Text style={{ fontFamily: theme.fonts.uiMed, fontSize: 13.5, color: theme.colors.textSecondary }}>
                        {t(isDuration ? 'home:upcoming.detail.setsDuration' : 'home:upcoming.detail.setsReps', {
                          sets: exercise.sets.length,
                          reps,
                          duration: reps,
                        })}
                      </Text>
                      {exercise.rest > 0 ? (
                        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textFaint, marginTop: 3 }}>
                          {t('home:upcoming.detail.rest', { seconds: exercise.rest })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}

            {workout.estimatedMinutes > 0 ? (
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18, color: theme.colors.textFaint, marginTop: 18 }}>
                {t('home:upcoming.detail.estimateNote')}
              </Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
