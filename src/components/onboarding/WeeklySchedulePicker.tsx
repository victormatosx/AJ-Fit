import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { WEEKDAY_ORDER } from '../../state/AppState';
import { useTheme } from '../../theme';
import {
  AVAILABLE_FREQUENCIES,
  selectFixedSchedule,
  selectFlexibleFrequency,
  selectFlexibleSchedule,
  toggleFixedTrainingDay,
  type WeeklyScheduleValue,
} from '../../onboarding/weeklyScheduleSelection';
import { Icon } from '../ui/Icon';
import type { LooseT } from './QuestionRenderer';

export function ScheduleModeLink({
  value,
  onChange,
}: {
  value: WeeklyScheduleValue;
  onChange: (value: WeeklyScheduleValue) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const selected = value.scheduleMode === 'flexible';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onChange(selected ? selectFixedSchedule() : selectFlexibleSchedule(value))}
      style={{ alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 4 }}
    >
      <Text
        style={{
          color: theme.colors.textMuted,
          fontFamily: theme.fonts.uiSemi,
          fontSize: 14,
          textDecorationLine: 'underline',
        }}
      >
        {tLoose(selected ? 'days.fixedModeLink' : 'days.flexible.label')}
      </Text>
    </Pressable>
  );
}

export function WeeklySchedulePicker({
  value,
  onChange,
}: {
  value: WeeklyScheduleValue;
  onChange: (value: WeeklyScheduleValue) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('quiz');
  const tLoose = t as unknown as LooseT;
  const flexible = value.scheduleMode === 'flexible';
  const selectedDays = value.scheduleMode === 'fixed' ? value.trainingDays ?? [] : [];

  return (
    <View style={{ height: 90 }}>
      {flexible ? (
        <View style={{ height: 90 }}>
          <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.uiSemi, fontSize: 14, lineHeight: 16 }}>
            {tLoose('days.flexibleFrequency')}
          </Text>
          <View style={{ position: 'absolute', top: 26, right: 0, left: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
            {AVAILABLE_FREQUENCIES.map((frequency) => {
              const selected = value.days === frequency;
              return (
                <View key={frequency} style={{ flex: 1, alignItems: 'center' }}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={tLoose('days.frequencyAccessibilityLabel', { count: frequency })}
                    accessibilityState={{ checked: selected }}
                    onPress={() => onChange(selectFlexibleFrequency(frequency))}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? theme.colors.primaryEmphasis : theme.colors.surfaceElevated,
                      borderWidth: selected ? 0 : 1.5,
                      borderColor: selected ? theme.colors.primaryEmphasis : theme.colors.inputBorder,
                      shadowColor: selected ? theme.colors.primaryEmphasis : 'transparent',
                      shadowOpacity: selected ? 0.4 : 0,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 0 },
                    }}
                  >
                    <Text style={{ color: selected ? theme.colors.choiceIndicator : theme.colors.textPrimary, fontFamily: theme.fonts.uiBold, fontSize: 13 }}>
                      {frequency}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={{ height: 90 }}>
          <View
            accessibilityLabel={tLoose('days.fixedDaysAccessibilityLabel')}
            style={{ position: 'absolute', top: 0, right: 0, left: 0, flexDirection: 'row', justifyContent: 'space-between' }}
          >
            {WEEKDAY_ORDER.map((day) => {
              const selected = selectedDays.includes(day);
              const label = tLoose(`trainingDays.options.${day}`);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange(toggleFixedTrainingDay(value, day))}
                  style={{ flex: 1, height: 64, alignItems: 'center' }}
                >
                  <Text
                    style={{
                      color: selected ? theme.colors.primaryEmphasis : theme.colors.textPrimary,
                      fontFamily: theme.fonts.uiBold,
                      fontSize: 13,
                      lineHeight: 16,
                    }}
                  >
                    {label}
                  </Text>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      marginTop: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? theme.colors.primaryEmphasis : theme.colors.surfaceElevated,
                      borderWidth: selected ? 0 : 1.5,
                      borderColor: selected ? theme.colors.primaryEmphasis : theme.colors.inputBorder,
                      shadowColor: selected ? theme.colors.primaryEmphasis : 'transparent',
                      shadowOpacity: selected ? 0.4 : 0,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 0 },
                    }}
                  >
                    {selected ? <Icon name="check" size={18} color={theme.colors.choiceIndicator} stroke={2.8} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={{ position: 'absolute', top: 72, right: 0, left: 0, height: 18, justifyContent: 'center' }}>
            {selectedDays.length === 1 ? (
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, textAlign: 'center' }}>
                {tLoose('days.minimumSelectionHint')}
              </Text>
            ) : selectedDays.length > 1 ? (
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 13, textAlign: 'center' }}>
                {tLoose('days.selectedCount', { count: selectedDays.length })}
              </Text>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
