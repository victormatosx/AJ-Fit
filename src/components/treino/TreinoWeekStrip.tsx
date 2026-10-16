import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import type { TreinoWeekStripDayViewModel } from '../../home/treinoWeekStrip';

const LETTER_FAINT = 'rgba(255,255,255,0.4)'; // spec §3.2.B letter on non-next training days
const SIGLA_FAINT = 'rgba(255,255,255,0.35)'; // spec §3.2.B weekday sigla on non-today days

function DayGlyph({ day }: { day: TreinoWeekStripDayViewModel }) {
  const { theme } = useTheme();

  if (day.glyph === 'COMPLETED') {
    return <Icon name="check" size={11} color={theme.colors.primaryEmphasis} stroke={2.6} />;
  }
  if (day.glyph === 'FULFILLED_EARLY') {
    return <Icon name="arrow-right" size={11} color={theme.colors.primaryEmphasis} stroke={2} />;
  }
  if (day.glyph === 'MISSED') {
    return <Icon name="x" size={11} color={theme.colors.textMuted} stroke={2} />;
  }
  if (day.sessionIndex != null) {
    return (
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 9,
          letterSpacing: 0.6,
          color: day.isNextSession ? theme.colors.primaryEmphasis : LETTER_FAINT,
        }}
      >
        {String.fromCharCode(65 + day.sessionIndex)}
      </Text>
    );
  }
  return null;
}

/**
 * "Faixa da semana" (Treino · Opção B §3.2.B). A single full-width
 * `Pressable` that opens the agenda editor — the week-summary count that
 * used to live in `WeeklyOverview`'s header is preserved in
 * `accessibilityLabel` only; the clean layout has no visual slot for it.
 */
export function TreinoWeekStrip({
  days,
  dimmed,
  disabled,
  weekSummaryLabel,
  onPress,
}: {
  days: TreinoWeekStripDayViewModel[];
  /** Flexible mode or workout-in-progress — visually de-emphasized, still pressable unless `disabled`. */
  dimmed: boolean;
  /** Workout in progress — the strip never opens the agenda while a session is running. */
  disabled: boolean;
  /** "{completed} de {scheduled} treinos esta semana" — folded into a11y only, see spec §9.3. */
  weekSummaryLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('treino');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('agenda.edit')} · ${weekSummaryLabel}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 22,
        flexDirection: 'row',
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {days.map((day) => (
        <View key={day.localDate} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              fontFamily: theme.fonts.mono,
              fontSize: 8.5,
              letterSpacing: 0.8,
              color: day.isToday ? theme.colors.textPrimary : SIGLA_FAINT,
            }}
          >
            {t(`agenda.weekday.${day.weekday}`)}
          </Text>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: day.isToday ? theme.colors.inverseSurface : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: theme.fonts.uiSemi,
                fontSize: 14,
                color: day.isToday
                  ? theme.colors.inverseForeground
                  : day.isTrainingDay
                    ? theme.colors.textPrimary
                    : theme.colors.textFaint,
              }}
            >
              {day.dayNumber}
            </Text>
          </View>
          <View style={{ height: 12, alignItems: 'center', justifyContent: 'center' }}>
            <DayGlyph day={day} />
          </View>
        </View>
      ))}
    </Pressable>
  );
}
