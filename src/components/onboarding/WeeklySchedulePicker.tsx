import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { WEEKDAY_ORDER } from '../../state/AppState';
import { useTheme } from '../../theme';
import { STANDARD_MAX_WEEKLY_DAYS } from '../../onboarding/weeklyDayAllowance';
import {
  frequenciesWithin,
  selectFixedSchedule,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../../onboarding/weeklyScheduleSelection';
import { Icon } from '../ui/Icon';
import { useAjFunnelDirector } from './AjFunnelStage';
import type { LooseT } from './QuestionRenderer';

/** Diameter of a weekday / frequency circle in the approved design. */
const DAY_CIRCLE = 42;

export function ScheduleModeLink({
  value,
  onChange,
  maxDays = STANDARD_MAX_WEEKLY_DAYS,
}: {
  value: WeeklyScheduleValue;
  onChange: (value: WeeklyScheduleValue) => void;
  maxDays?: number;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const selected = value.scheduleMode === 'flexible';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      // Clearing whatever the other mode had recorded is `selectFixedSchedule`
      // / `selectFlexibleSchedule`'s job, unchanged — this only flips which
      // one runs.
      onPress={() => onChange(selected ? selectFixedSchedule() : selectFlexibleSchedule(value, maxDays))}
      style={{ alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <Text
        style={{
          color: theme.colors.textSubtle,
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14,
          textDecorationLine: 'underline',
          textDecorationColor: theme.colors.textSubtle,
        }}
      >
        {tLoose(selected ? 'days.fixedModeLink' : 'days.flexible.label')}
      </Text>
    </Pressable>
  );
}

/** One circle, shared by the weekday grid and the frequency row. */
function DayCircle({
  label,
  caption,
  selected,
  accessibilityRole,
  accessibilityLabel,
  onPress,
}: {
  label?: string;
  caption?: string;
  selected: boolean;
  accessibilityRole: 'checkbox' | 'radio';
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center' }}
    >
      {caption ? (
        <Text
          style={{
            color: selected ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
            fontFamily: theme.fonts.uiSemi,
            fontSize: 14,
            lineHeight: 18,
            marginBottom: 10,
          }}
        >
          {caption}
        </Text>
      ) : null}
      <View
        style={{
          width: DAY_CIRCLE,
          height: DAY_CIRCLE,
          borderRadius: DAY_CIRCLE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.scheduleDayActive : theme.colors.surfaceMuted,
          borderWidth: selected ? 0 : 1,
          borderColor: theme.colors.fieldBorderStrong,
          shadowColor: selected ? theme.colors.primaryGlowBright : 'transparent',
          shadowOpacity: selected ? 1 : 0,
          shadowRadius: selected ? 16 : 0,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        {label ? (
          <Text
            style={{
              color: selected ? theme.colors.primaryForeground : theme.colors.textPrimary,
              fontFamily: theme.fonts.uiSemi,
              fontSize: 14,
            }}
          >
            {label}
          </Text>
        ) : selected ? (
          <Icon name="check" size={16} color={theme.colors.primaryForeground} stroke={2.8} />
        ) : null}
      </View>
    </Pressable>
  );
}

export function WeeklySchedulePicker({
  value,
  onChange,
  maxDays = STANDARD_MAX_WEEKLY_DAYS,
}: {
  value: WeeklyScheduleValue;
  onChange: (value: WeeklyScheduleValue) => void;
  /** Per-level weekly ceiling (`weeklyDayAllowance.ts`); 7 means uncapped. */
  maxDays?: number;
}) {
  const { theme } = useTheme();
  // The funnel's persistent mascot, reached directly rather than through a
  // prop chain: outside the funnel this resolves to an inert director, so the
  // picker works unchanged anywhere else.
  const aj = useAjFunnelDirector();
  const onToggled = (selected: boolean) => {
    aj.setLook([0, 2.2]);
    aj.play(selected ? 'hop' : 'nod');
  };
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const flexible = value.scheduleMode === 'flexible';
  const selectedDays = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];
  // Below the minimum the status line turns into the correction, in the error
  // colour — the CTA's own disabled state still comes from
  // `isWeeklyScheduleComplete`, untouched.
  const belowMinimum = !flexible && selectedDays.length > 0 && selectedDays.length < 2;
  // Same status line, same slot, same style — only the message differs, the
  // way `belowMinimum` already works. Every weekday stays tappable; this just
  // explains why the next one does not latch. Shown at EVERY level's own
  // ceiling (3 for beginners, 6 for the rest), never only the beginner one.
  const atMaximum = !flexible && selectedDays.length >= maxDays;

  const statusStyle = {
    fontFamily: theme.fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center' as const,
    color: belowMinimum ? theme.colors.fieldErrorText : theme.colors.textMuted,
  };

  return (
    <View>
      {flexible ? (
        <View>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.uiSemi,
              fontSize: 15,
              lineHeight: 20,
              textAlign: 'center',
              marginBottom: 18,
            }}
          >
            {tLoose('days.flexibleFrequency')}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {frequenciesWithin(maxDays).map((frequency) => (
              <DayCircle
                key={frequency}
                label={String(frequency)}
                selected={value.days === frequency}
                accessibilityRole="radio"
                accessibilityLabel={tLoose('days.frequencyAccessibilityLabel', { count: frequency })}
                onPress={() => {
                  onChange(selectFlexibleFrequency(frequency, maxDays));
                  onToggled(true);
                }}
              />
            ))}
          </View>
          <Text style={[statusStyle, { marginTop: 18 }]}>
            {tLoose('days.flexibleStatus', { count: value.days ?? 0 })}
          </Text>
        </View>
      ) : (
        <View>
          <View
            accessibilityLabel={tLoose('days.fixedDaysAccessibilityLabel')}
            style={{ flexDirection: 'row', justifyContent: 'space-between' }}
          >
            {WEEKDAY_ORDER.map((day) => {
              const selected = selectedDays.includes(day);
              return (
                <DayCircle
                  key={day}
                  caption={tLoose(`trainingDays.options.${day}`)}
                  selected={selected}
                  accessibilityRole="checkbox"
                  accessibilityLabel={tLoose(`trainingDays.options.${day}`)}
                  onPress={() => {
                    onChange(toggleFixedTrainingDay(value, day, maxDays));
                    onToggled(!selected);
                  }}
                />
              );
            })}
          </View>

          <View style={{ marginTop: 18, minHeight: 19, justifyContent: 'center' }}>
            {belowMinimum ? (
              <Text accessibilityRole="alert" style={statusStyle}>
                {tLoose('days.minimumSelectionHint')}
              </Text>
            ) : atMaximum ? (
              <Text style={statusStyle}>
                {tLoose('days.maximumSelectionHint', { max: maxDays })}
              </Text>
            ) : selectedDays.length > 1 ? (
              <Text style={statusStyle}>
                {tLoose('days.selectedCount', { count: selectedDays.length })}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
