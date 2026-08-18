import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  type ProgressLoadExerciseId,
  type ProgressLoadExercisePreview,
} from '../../data/progressDesignMocks';
import { useUnits } from '../../state/UnitsContext';
import { colors, fonts, radii, sizes, spacing } from '../../theme/tokens';
import {
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { EvolutionAreaChart } from './EvolutionAreaChart';

const GUTTER = sizes.screenGutter;

function Rule() {
  return (
    <View
      style={{
        height: sizes.hairline,
        backgroundColor: colors.border,
        marginHorizontal: GUTTER,
        marginVertical: spacing[5],
      }}
    />
  );
}

export function LoadsEvolutionView({
  exercises,
}: {
  exercises: ProgressLoadExercisePreview[];
}) {
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const [selectedId, setSelectedId] = useState<ProgressLoadExerciseId>(
    exercises[0]?.id ?? 'benchPress',
  );

  const selected = exercises.find((exercise) => exercise.id === selectedId) ?? exercises[0];
  const unit = workoutLoadUnit(resolvedUnits);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' }),
    [],
  );

  if (!selected || selected.history.length === 0) return null;

  const first = selected.history[0]!;
  const latest = selected.history[selected.history.length - 1]!;
  const deltaKg = latest.loadKg - first.loadKg;
  const chartValues = selected.history.map((point) =>
    workoutLoadFromKg(point.loadKg, resolvedUnits),
  );

  return (
    <View>
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[4] }}>
          {t('progress.loads.eyebrow').toUpperCase()}
        </Slash>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
          {exercises.map((exercise) => {
            const selectedExercise = exercise.id === selected.id;
            const label = t(`progress.loads.exercises.${exercise.id}.short`);
            return (
              <Pressable
                key={exercise.id}
                onPress={() => setSelectedId(exercise.id)}
                accessibilityRole="tab"
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: label })}
                accessibilityState={{ selected: selectedExercise }}
                style={({ pressed }) => ({
                  minHeight: sizes.controlSm,
                  justifyContent: 'center',
                  paddingHorizontal: spacing[3.5],
                  borderRadius: radii.control,
                  borderWidth: 1,
                  borderColor: selectedExercise ? colors.accentHi : colors.border,
                  backgroundColor: selectedExercise ? colors.surfaceSelected : colors.surface,
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <MonoLabel color={selectedExercise ? colors.text : colors.faint} size={9}>
                  {label}
                </MonoLabel>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: spacing[6] }}>
          <MonoLabel size={9} style={{ marginBottom: spacing[2] }}>
            {t('progress.loads.maxLoad', {
              exercise: t(`progress.loads.exercises.${selected.id}.full`),
            })}
          </MonoLabel>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
            <Display size={54}>{formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits)}</Display>
            <MonoLabel size={12}>{unit.toUpperCase()}</MonoLabel>
            <Text
              style={{
                marginLeft: spacing[1],
                fontFamily: fonts.mono,
                fontSize: 11,
                color: colors.accentHi,
              }}
            >
              {t('progress.loads.delta', {
                direction: deltaKg >= 0 ? '↑' : '↓',
                value: formatWorkoutLoadFromKg(Math.abs(deltaKg), resolvedUnits),
                unit,
              })}
            </Text>
          </View>
          <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
            {t('progress.loads.period', { count: 12 })}
          </MonoLabel>
        </View>
      </View>

      <View
        accessible
        accessibilityLabel={t('progress.loads.accessibility.chart', {
          exercise: t(`progress.loads.exercises.${selected.id}.full`),
          value: formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits),
          unit,
        })}
        style={{ marginTop: spacing[6], paddingHorizontal: GUTTER }}
      >
        <EvolutionAreaChart values={chartValues} />
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: spacing[2],
          }}
        >
          <MonoLabel size={9}>{dateFormatter.format(first.recordedAt)}</MonoLabel>
          <MonoLabel size={9}>{dateFormatter.format(latest.recordedAt)}</MonoLabel>
        </View>
      </View>

      <Rule />

      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>
          {t('progress.loads.recordsTitle').toUpperCase()}
        </Slash>

        {exercises.map((exercise) => {
          const oldestRecord = exercise.history[0]!;
          const newestRecord = exercise.history[exercise.history.length - 1]!;
          const gain = newestRecord.loadKg - oldestRecord.loadKg;
          return (
            <View
              key={exercise.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing[3.5],
                paddingVertical: spacing[3],
                borderBottomWidth: sizes.hairline,
                borderBottomColor: colors.border,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radii.sm,
                  backgroundColor: colors.accentSoft,
                }}
              >
                <Icon name="trophy" size={17} color={colors.accentHi} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.text }}>
                  {t(`progress.loads.exercises.${exercise.id}.full`)}
                </Text>
                <MonoLabel size={8.5} style={{ marginTop: spacing[1] }}>
                  {t('progress.loads.recordedAt', {
                    date: dateFormatter.format(newestRecord.recordedAt),
                  })}
                </MonoLabel>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.display, fontSize: 18, color: colors.text }}>
                  {formatWorkoutLoadFromKg(newestRecord.loadKg, resolvedUnits)}{' '}
                  <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.faint }}>
                    {unit.toUpperCase()}
                  </Text>
                </Text>
                <Text style={{ fontFamily: fonts.mono, fontSize: 9.5, color: colors.accentHi }}>
                  {t('progress.loads.gain', {
                    value: formatWorkoutLoadFromKg(gain, resolvedUnits),
                    unit,
                  })}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
