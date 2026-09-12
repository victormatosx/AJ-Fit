import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { computeRemainingSeconds, type ActiveRest } from '../../lib/restTimer';
import { Icon } from '../ui/Icon';

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function WorkoutRestHeaderStatus({
  workoutInProgress,
  rest,
  resting,
  onPress,
}: {
  workoutInProgress: boolean;
  rest: ActiveRest | null;
  resting: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!resting || !rest) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [rest, resting]);

  if (!workoutInProgress) return null;

  const restFinished = rest !== null && !resting;
  const nextIsExercise = rest !== null && rest.setIndex + 1 >= rest.totalSets;
  const nextStep = nextIsExercise
    ? t('activeWorkout.nextExercise')
    : rest !== null
      ? t('activeWorkout.nextSet', { number: rest.setIndex + 2 })
      : null;
  const countdown = rest === null
    ? null
    : formatCountdown(resting ? computeRemainingSeconds(rest, now) : 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={resting
        ? t('activeWorkout.headerAccessibilityRest', { time: countdown, nextStep })
        : restFinished
          ? t('activeWorkout.headerAccessibilityFinished', { nextStep })
          : t('activeWorkout.return')}
      onPress={onPress}
      style={({ pressed }) => ({
        width: rest === null ? 42 : restFinished ? 106 : 86,
        height: 42,
        marginRight: 10,
        paddingHorizontal: 9,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: theme.colors.primaryBorderSoft,
        backgroundColor: 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      {rest !== null && (
        <>
          <Icon
            name="timer"
            size={14}
            stroke={1.9}
            color={theme.colors.primaryEmphasis}
          />
          <Text
            style={{
              fontFamily: theme.fonts.monoBold,
              fontSize: 13,
              letterSpacing: 0.2,
              color: theme.colors.textPrimary,
            }}
          >
            {countdown}
          </Text>
        </>
      )}
      {!resting && (
        <Icon
          name="arrow-right"
          size={17}
          stroke={2.1}
          color={theme.colors.primaryEmphasis}
        />
      )}
    </Pressable>
  );
}
