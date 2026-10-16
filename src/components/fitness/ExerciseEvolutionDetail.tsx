import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  LOAD_PROGRESS_PERIODS,
  loadHistoryForPeriod,
  type ExerciseLoadProgress,
  type LoadProgressPeriod,
} from '../../loadProgress/loadProgress';
import { exerciseDisplayName } from '../../services/exerciseSubstitutionCandidates';
import { useUnits } from '../../state/UnitsContext';
import { radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { EvolutionAreaChart } from './EvolutionAreaChart';

/**
 * Full-screen detail for a single exercise's load history — opened from
 * "Recordes recentes" or the exercise search/list in `LoadsEvolutionView`.
 * Presentation only: same content that block used to render inline, just
 * given its own screen so the chart has room to breathe. `ProgressScreen`
 * owns when this is mounted (swapping its whole body for this component,
 * the same technique it already uses for the Photos tab) and which
 * `ExerciseLoadProgress` to hand it.
 */

const GUTTER = sizes.screenGutter;

function localDateAsDate(localDate: string): Date {
  return new Date(`${localDate}T12:00:00`);
}

/** Small date caption under a chart's left/right edge. Mirrors `LoadsEvolutionView`'s own. */
function AxisDate({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
      {children}
    </Text>
  );
}

interface Props {
  exercise: ExerciseLoadProgress;
  todayLocalDate: string;
  onBack: () => void;
}

export function ExerciseEvolutionDetail({ exercise, todayLocalDate, onBack }: Props) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation(['home', 'common']);
  const { resolvedUnits } = useUnits();
  const [period, setPeriod] = useState<LoadProgressPeriod>(90);

  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const exerciseName = exerciseDisplayName(exercise.exerciseId, catalogLocale);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [i18n.language, i18n.resolvedLanguage],
  );

  const periodHistory = loadHistoryForPeriod(exercise.history, period, todayLocalDate);
  const first = periodHistory[0] ?? null;
  const latest = periodHistory[periodHistory.length - 1] ?? null;
  const deltaKg = first && latest ? latest.loadKg - first.loadKg : null;
  const unit = workoutLoadUnit(resolvedUnits);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing[8] }}>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3] }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common:actions.back')}
          style={{
            width: 44,
            height: 44,
            borderRadius: radii.control,
            backgroundColor: theme.colors.surfaceRaised,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow-left" size={17} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[6] }}>
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 18, color: theme.colors.textPrimary }}>
          {exerciseName}
        </Text>

        {latest ? (
          <>
            <View style={{ marginTop: spacing[4] }}>
              <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>
                {t('progress.loads.currentLoad').toUpperCase()}
              </MonoLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: spacing[1.5] }}>
                <Display size={52}>{formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits)}</Display>
                <Text
                  style={{
                    marginLeft: spacing[1.5],
                    fontFamily: theme.fonts.ui,
                    fontSize: 15,
                    color: theme.colors.textMuted,
                  }}
                >
                  {unit}
                </Text>
              </View>
              <Text
                style={{
                  marginTop: spacing[2],
                  fontFamily: theme.fonts.ui,
                  fontSize: 13,
                  color: theme.colors.textMuted,
                }}
              >
                {deltaKg != null && periodHistory.length > 1 ? (
                  <>
                    <Text
                      style={{
                        fontFamily: theme.fonts.uiSemi,
                        color: deltaKg >= 0 ? theme.colors.primaryEmphasis : theme.colors.dangerText,
                      }}
                    >
                      {`${deltaKg >= 0 ? '+' : '−'}${formatWorkoutLoadFromKg(Math.abs(deltaKg), resolvedUnits)} ${unit}`}
                    </Text>
                    {` ${t('progress.loads.periodDifference', { days: period })}`}
                  </>
                ) : (
                  t('progress.loads.noComparison')
                )}
              </Text>
            </View>

            {periodHistory.length > 1 ? (
              <View style={{ marginTop: spacing[5] }}>
                <EvolutionAreaChart
                  variant="line"
                  height={150}
                  points={periodHistory.map((point) => ({
                    value: workoutLoadFromKg(point.loadKg, resolvedUnits),
                    displayValue: `${formatWorkoutLoadFromKg(point.loadKg, resolvedUnits)} ${unit.toUpperCase()}`,
                    label: dateFormatter.format(localDateAsDate(point.localDate)),
                  }))}
                  formatAxisValue={(value) => String(Math.round(value))}
                  accessibilityLabel={t('progress.loads.accessibility.chart', {
                    exercise: exerciseName,
                    value: formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits),
                    unit,
                  })}
                  accessibilityHint={t('progress.chartInteractionHint')}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                  <AxisDate>{dateFormatter.format(localDateAsDate(first!.localDate))}</AxisDate>
                  <AxisDate>{dateFormatter.format(localDateAsDate(latest.localDate))}</AxisDate>
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: spacing[7], gap: spacing[2] }}>
            <Icon name="chart" size={23} color={theme.colors.textFaint} />
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' }}>
              {t('progress.loads.noDataForPeriod')}
            </Text>
          </View>
        )}

        {/* Segmented period selector, under the chart it drives. */}
        <View
          style={{
            flexDirection: 'row',
            marginTop: spacing[4],
            padding: 3,
            borderRadius: radii.control,
            backgroundColor: theme.colors.surfaceElevated,
          }}
        >
          {LOAD_PROGRESS_PERIODS.map((value) => {
            const active = period === value;
            return (
              <Pressable
                key={value}
                onPress={() => setPeriod(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 38,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radii.sm,
                  backgroundColor: active ? theme.colors.borderStrong : 'transparent',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <MonoLabel size={9} color={active ? theme.colors.textPrimary : theme.colors.textFaint}>
                  {t(`progress.loads.ranges.${value}`)}
                </MonoLabel>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
