import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  LOAD_PROGRESS_PERIODS,
  loadHistoryForPeriod,
  normalizeExerciseSearch,
  type ExerciseLoadProgress,
  type LoadPersonalRecord,
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
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { EvolutionAreaChart } from './EvolutionAreaChart';
import { EvolutionLockedPreview } from './EvolutionLockedPreview';
import { buildDemoLoadExercises, buildDemoLoadRecords } from './demoLoadProgressData';

const GUTTER = sizes.screenGutter;

function Rule() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: sizes.hairline,
        backgroundColor: theme.colors.border,
        marginHorizontal: GUTTER,
        marginVertical: spacing[5],
      }}
    />
  );
}

function localDateAsDate(localDate: string): Date {
  return new Date(`${localDate}T12:00:00`);
}

export function LoadsEvolutionView({
  exercises,
  recordsLast90Days,
  todayLocalDate,
  loading,
  error,
  onRetry,
  onStartWorkout,
}: {
  exercises: ExerciseLoadProgress[];
  recordsLast90Days: LoadPersonalRecord[];
  todayLocalDate: string;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Starts a workout. Absent when the host cannot drive that flow. */
  onStartWorkout?: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<LoadProgressPeriod>(90);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showAllRecords, setShowAllRecords] = useState(false);

  // No real load history yet: feed the exact same panel with local,
  // non-persisted demo data instead of a plain "no data" block. Never
  // computed when real data exists, and never mixed with it.
  const demoExercises = useMemo(
    () => (exercises.length ? [] : buildDemoLoadExercises(todayLocalDate)),
    [exercises.length, todayLocalDate],
  );
  const demoRecords = useMemo(
    () => (exercises.length ? [] : buildDemoLoadRecords(todayLocalDate)),
    [exercises.length, todayLocalDate],
  );
  const displayExercises = exercises.length ? exercises : demoExercises;
  const displayRecords = exercises.length ? recordsLast90Days : demoRecords;

  const catalogLocale = i18n.language === 'pt-BR' ? 'ptBR' : i18n.language === 'es' ? 'es' : 'en';
  const exerciseName = (exerciseId: string) => exerciseDisplayName(exerciseId, catalogLocale);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [i18n.language, i18n.resolvedLanguage],
  );

  const orderedExercises = useMemo(
    () => displayExercises.slice().sort((a, b) => {
      const aLatest = a.history[a.history.length - 1]?.localDate ?? '';
      const bLatest = b.history[b.history.length - 1]?.localDate ?? '';
      return bLatest.localeCompare(aLatest) || exerciseName(a.exerciseId).localeCompare(exerciseName(b.exerciseId));
    }),
    // The translated catalog name changes with i18n.language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayExercises, i18n.language],
  );

  useEffect(() => {
    if (selectedId && displayExercises.some((exercise) => exercise.exerciseId === selectedId)) return;
    setSelectedId(orderedExercises[0]?.exerciseId ?? null);
  }, [displayExercises, orderedExercises, selectedId]);

  const selected = displayExercises.find((exercise) => exercise.exerciseId === selectedId) ?? null;
  const normalizedQuery = normalizeExerciseSearch(query);
  const searchResults = orderedExercises
    .filter((exercise) => normalizeExerciseSearch(exerciseName(exercise.exerciseId)).includes(normalizedQuery))
    .slice(0, 8);
  const periodHistory = selected
    ? loadHistoryForPeriod(selected.history, period, todayLocalDate)
    : [];
  const first = periodHistory[0] ?? null;
  const latest = periodHistory[periodHistory.length - 1] ?? null;
  const deltaKg = first && latest ? latest.loadKg - first.loadKg : null;
  const unit = workoutLoadUnit(resolvedUnits);
  const visibleRecords = showAllRecords ? displayRecords : displayRecords.slice(0, 3);

  if (loading && exercises.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: spacing[10] }}>
        <ActivityIndicator color={theme.colors.primaryEmphasis} />
        <MonoLabel size={9} style={{ marginTop: spacing[3] }}>
          {t('progress.loads.loading').toUpperCase()}
        </MonoLabel>
      </View>
    );
  }

  if (error && exercises.length === 0) {
    return (
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[6] }}>
        <Slash>{t('progress.loads.eyebrow').toUpperCase()}</Slash>
        <View style={{ alignItems: 'center', paddingVertical: spacing[9], gap: spacing[3] }}>
          <Icon name="alert-triangle" size={25} color={theme.colors.dangerText} />
          <Display size={20} style={{ textAlign: 'center' }}>{t('progress.loads.error.title')}</Display>
          <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, textAlign: 'center' }}>
            {t('progress.loads.error.description')}
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: sizes.controlMd,
              justifyContent: 'center',
              paddingHorizontal: spacing[5],
              borderRadius: radii.control,
              backgroundColor: theme.colors.primary,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <MonoLabel size={9} color={theme.colors.primaryForeground}>{t('progress.loads.error.retry')}</MonoLabel>
          </Pressable>
        </View>
      </View>
    );
  }

  const panel = (
    <View>
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[4] }}>{t('progress.loads.records90Title').toUpperCase()}</Slash>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
          <Display size={54}>{displayRecords.length}</Display>
          <MonoLabel size={10} color={theme.colors.textMuted}>
            {t('progress.loads.recordsCount', { count: displayRecords.length }).toUpperCase()}
          </MonoLabel>
        </View>

        <Slash style={{ marginTop: spacing[6], marginBottom: spacing[2] }}>
          {t('progress.loads.topRecords').toUpperCase()}
        </Slash>
        {visibleRecords.length === 0 ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted }}>
            {t('progress.loads.noRecentRecords')}
          </Text>
        ) : visibleRecords.map((record) => (
          <View
            key={`${record.executionId}:${record.exerciseId}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3.5], paddingVertical: spacing[3], borderBottomWidth: sizes.hairline, borderBottomColor: theme.colors.border }}
          >
            <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, backgroundColor: theme.colors.primarySoft }}>
              <Icon name="trophy" size={17} color={theme.colors.primaryEmphasis} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
                {exerciseName(record.exerciseId)}
              </Text>
              <MonoLabel size={8.5} style={{ marginTop: spacing[1] }}>
                {t('progress.loads.recordedAt', { date: dateFormatter.format(localDateAsDate(record.localDate)) })}
              </MonoLabel>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: theme.fonts.display, fontSize: 18, color: theme.colors.textPrimary }}>
                {formatWorkoutLoadFromKg(record.loadKg, resolvedUnits)}{' '}
                <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint }}>{unit.toUpperCase()}</Text>
              </Text>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9.5, color: theme.colors.primaryEmphasis }}>
                {t('progress.loads.recordGain', {
                  value: formatWorkoutLoadFromKg(record.loadKg - record.previousBestKg, resolvedUnits),
                  unit,
                })}
              </Text>
            </View>
          </View>
        ))}

        {displayRecords.length > 3 ? (
          <Pressable
            onPress={() => setShowAllRecords((current) => !current)}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: sizes.controlMd, marginTop: spacing[3], alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, borderWidth: 1, borderColor: theme.colors.border, opacity: pressed ? 0.78 : 1 })}
          >
            <MonoLabel size={9} color={theme.colors.primaryEmphasis}>
              {t(showAllRecords ? 'progress.loads.showLess' : 'progress.loads.seeAllRecords').toUpperCase()}
            </MonoLabel>
          </Pressable>
        ) : null}
      </View>

      <Rule />

      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>{t('progress.loads.exerciseEvolution').toUpperCase()}</Slash>
        <View style={{ height: 52, borderRadius: radii.lg, borderWidth: 1, borderColor: searchFocused ? theme.colors.inputBorderFocusStrong : theme.colors.inputBorder, backgroundColor: theme.colors.inputBackground, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], gap: spacing[2.5] }}>
          <Icon name="search" size={18} color={searchFocused ? theme.colors.primaryEmphasis : theme.colors.inputIcon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t('progress.loads.searchPlaceholder')}
            placeholderTextColor={theme.colors.inputPlaceholder}
            selectionColor={theme.colors.inputSelection}
            autoCorrect={false}
            style={{ flex: 1, color: theme.colors.inputText, fontFamily: theme.fonts.uiMed, fontSize: 14 }}
          />
        </View>

        <View style={{ marginTop: spacing[2] }}>
          {searchResults.length === 0 ? (
            <MonoLabel size={9} style={{ paddingVertical: spacing[3] }}>{t('progress.loads.noExerciseFound')}</MonoLabel>
          ) : searchResults.map((exercise) => {
            const isSelected = selectedId === exercise.exerciseId;
            const latestPoint = exercise.history[exercise.history.length - 1]!;
            return (
              <Pressable
                key={exercise.exerciseId}
                onPress={() => { setSelectedId(exercise.exerciseId); setQuery(''); }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: exerciseName(exercise.exerciseId) })}
                style={({ pressed }) => ({ minHeight: 48, paddingVertical: spacing[2.5], flexDirection: 'row', alignItems: 'center', borderBottomWidth: sizes.hairline, borderBottomColor: theme.colors.border, opacity: pressed ? 0.75 : 1 })}
              >
                <Text style={{ flex: 1, fontFamily: isSelected ? theme.fonts.uiSemi : theme.fonts.ui, fontSize: 13.5, color: isSelected ? theme.colors.primaryEmphasis : theme.colors.textPrimary }}>
                  {exerciseName(exercise.exerciseId)}
                </Text>
                <MonoLabel size={9} color={theme.colors.textMuted}>
                  {formatWorkoutLoadFromKg(latestPoint.loadKg, resolvedUnits)} {unit.toUpperCase()}
                </MonoLabel>
                <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
              </Pressable>
            );
          })}
        </View>

        {selected ? (
          <View style={{ marginTop: spacing[6] }}>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 18, color: theme.colors.textPrimary }}>
              {exerciseName(selected.exerciseId)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
              {LOAD_PROGRESS_PERIODS.map((value) => {
                const active = period === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setPeriod(value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => ({ flex: 1, minHeight: sizes.controlSm, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, borderWidth: 1, borderColor: active ? theme.colors.primaryEmphasis : theme.colors.border, backgroundColor: active ? theme.colors.surfaceSelected : theme.colors.surface, opacity: pressed ? 0.8 : 1 })}
                  >
                    <MonoLabel size={8.5} color={active ? theme.colors.textPrimary : theme.colors.textFaint}>
                      {t(`progress.loads.ranges.${value}`)}
                    </MonoLabel>
                  </Pressable>
                );
              })}
            </View>

            {latest ? (
              <>
                <View style={{ marginTop: spacing[5] }}>
                  <MonoLabel size={9}>{t('progress.loads.currentLoad').toUpperCase()}</MonoLabel>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2], marginTop: spacing[1] }}>
                    <Display size={48}>{formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits)}</Display>
                    <MonoLabel size={11}>{unit.toUpperCase()}</MonoLabel>
                    {deltaKg != null && periodHistory.length > 1 ? (
                      <Text style={{ marginLeft: spacing[1], fontFamily: theme.fonts.mono, fontSize: 10.5, color: deltaKg >= 0 ? theme.colors.primaryEmphasis : theme.colors.dangerText }}>
                        {deltaKg >= 0 ? '↑' : '↓'} {deltaKg >= 0 ? '+' : '-'}
                        {formatWorkoutLoadFromKg(Math.abs(deltaKg), resolvedUnits)} {unit}
                      </Text>
                    ) : null}
                  </View>
                  <MonoLabel size={9} style={{ marginTop: spacing[1] }}>
                    {periodHistory.length > 1 ? t('progress.loads.periodDifference', { days: period }) : t('progress.loads.noComparison')}
                  </MonoLabel>
                </View>

                {periodHistory.length > 1 ? (
                  <View
                    style={{ marginTop: spacing[5] }}
                  >
                    <EvolutionAreaChart
                      points={periodHistory.map((point) => ({
                        value: workoutLoadFromKg(point.loadKg, resolvedUnits),
                        displayValue: `${formatWorkoutLoadFromKg(point.loadKg, resolvedUnits)} ${unit.toUpperCase()}`,
                        label: dateFormatter.format(localDateAsDate(point.localDate)),
                      }))}
                      accessibilityLabel={t('progress.loads.accessibility.chart', {
                        exercise: exerciseName(selected.exerciseId),
                        value: formatWorkoutLoadFromKg(latest.loadKg, resolvedUnits),
                        unit,
                      })}
                      accessibilityHint={t('progress.chartInteractionHint')}
                    />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                      <MonoLabel size={9}>{dateFormatter.format(localDateAsDate(first!.localDate))}</MonoLabel>
                      <MonoLabel size={9}>{dateFormatter.format(localDateAsDate(latest.localDate))}</MonoLabel>
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
          </View>
        ) : null}
      </View>
    </View>
  );

  if (exercises.length === 0) {
    return (
      <EvolutionLockedPreview
        title={t('progress.loads.empty.title')}
        description={t('progress.loads.empty.description')}
        ctaLabel={onStartWorkout ? t('progress.loads.empty.cta') : undefined}
        onPress={onStartWorkout}
      >
        {panel}
      </EvolutionLockedPreview>
    );
  }

  return panel;
}
