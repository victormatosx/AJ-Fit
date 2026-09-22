import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { resolveSessionDisplayName, type LooseTranslate } from '../../workoutPrescription/sessionPresentation';
import type { UpcomingWorkoutViewModel } from '../../home/upcomingWorkouts';

const WEEKDAY_COLUMN_WIDTH = 46;
const FLEXIBLE_LABEL_WIDTH = 82;

/**
 * "Próximos treinos" — the forward view of the plan that the Today poster
 * deliberately doesn't show. Every row is a pure render of one
 * `UpcomingWorkoutViewModel` (built by `buildUpcomingWorkouts` from the real
 * Schedule Engine resolution + the real prescribed sessions); nothing here
 * recomputes dates, rotation or counts.
 *
 * Tapping a row opens the session's details — it is never a start action:
 * only the Schedule Engine decides what may be started, and only today's
 * session ever can be.
 */
export function UpcomingWorkouts({
  workouts,
  onSelect,
  enabled = true,
}: {
  workouts: readonly UpcomingWorkoutViewModel[];
  onSelect: (workout: UpcomingWorkoutViewModel) => void;
  enabled?: boolean;
}) {
  const { t } = useTranslation(['home', 'quiz', 'workout']);
  const { theme } = useTheme();
  const tLoose = t as unknown as LooseTranslate;

  if (workouts.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 8 }}>
      <Slash style={{ marginBottom: 12 }}>{t('home:upcoming.title')}</Slash>

      <View style={{ gap: 10 }}>
        {workouts.map((workout) => {
          const weekdayLabel = workout.flexible
            ? t('home:upcoming.flexible').toUpperCase()
            : tLoose(`quiz:trainingDays.options.${workout.weekday}`).toUpperCase();
          const sessionLabel = resolveSessionDisplayName(
            tLoose,
            workout.sessionName,
            workout.sessionType,
            workout.sessionDisplayName,
          );
          const meta = workout.estimatedMinutes > 0
            ? t('home:upcoming.meta', {
                minutes: workout.estimatedMinutes,
                count: workout.exerciseCount,
              })
            : t('home:upcoming.metaNoEstimate', { count: workout.exerciseCount });

          return (
            <Pressable
              key={`${workout.localDate}:${workout.sessionIndex}`}
              accessibilityRole="button"
              accessibilityLabel={t('home:upcoming.open', {
                weekday: weekdayLabel,
                session: sessionLabel,
              })}
              onPress={enabled ? () => onSelect(workout) : undefined}
              disabled={!enabled}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 16,
                paddingHorizontal: 16,
                borderRadius: theme.radii.xl,
                borderWidth: 1,
                borderColor: theme.colors.cardBorder,
                backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface,
              })}
            >
              <Text
                style={{
                  width: workout.flexible ? FLEXIBLE_LABEL_WIDTH : WEEKDAY_COLUMN_WIDTH,
                  fontFamily: theme.fonts.monoBold,
                  fontSize: 14,
                  letterSpacing: 1.2,
                  color: theme.colors.textFaint,
                }}
                numberOfLines={1}
                ellipsizeMode="clip"
              >
                {weekdayLabel}
              </Text>

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: theme.fonts.uiBold,
                    fontSize: 16.5,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {sessionLabel}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: 12,
                    color: theme.colors.textFaint,
                    marginTop: 4,
                  }}
                >
                  {meta}
                </Text>
              </View>

              <Icon name="chevron-right" size={18} color={theme.colors.textFaint} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
