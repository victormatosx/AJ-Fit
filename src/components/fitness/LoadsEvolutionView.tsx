import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  normalizeExerciseSearch,
  type ExerciseLoadProgress,
  type LoadPersonalRecord,
  type LoadProgressPeriod,
} from '../../loadProgress/loadProgress';
import { deriveMuscleGroupLoadGains } from '../../loadProgress/muscleGroupLoadProgress';
import { getExerciseTarget } from '../../lib/muscleCatalog';
import { exerciseDisplayName } from '../../services/exerciseSubstitutionCandidates';
import type { MuscleId } from '../../types/exercise';
import type { Sex } from '../../state/AppState';
import { useUnits } from '../../state/UnitsContext';
import { opacity, radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  formatWorkoutLoadFromKg,
  workoutLoadUnit,
} from '../../units/workoutLoadConversions';
import { BodyMuscleMap } from './BodyMuscleMap';
import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';

/**
 * The "Cargas" panel of the Evolution screen.
 *
 * Presentation only: every number is either a point the load projection
 * already produced (`ExerciseLoadProgress.history`, `LoadPersonalRecord`) or
 * an explicit arithmetic projection of those points — see
 * `deriveMuscleGroupLoadGains` for the per-muscle one, which states its own
 * rules. Nothing here reads a store, and nothing is ever filled in with a
 * placeholder figure.
 *
 * Visual language: hairline-separated rows, no cards and no surfaces, with
 * one body map leading the panel. Mirrors `BodyEvolutionView`.
 */

const GUTTER = sizes.screenGutter;
/** Width of each silhouette in the strength map. */
const STRENGTH_MAP_SIZE = 150;
/** Below this width the empty state steps its map and name column down. */
const NARROW_SCREEN = 360;
/** Strength map width on a narrow screen. */
const STRENGTH_MAP_SIZE_NARROW = 130;
/** Window the muscle-group projection and the record list both read. */
const MUSCLE_GROUP_PERIOD: LoadProgressPeriod = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Travessão standing in for a figure that does not exist yet. */
const NO_VALUE = '—';
/** How many steps "Como funciona" explains. Keyed as `steps.1..3` in i18n. */
const HOW_IT_WORKS_STEPS = [1, 2, 3] as const;

/**
 * The five groups the empty "Por grupo muscular" list previews.
 *
 * With no execution recorded, `deriveMuscleGroupLoadGains` has nothing to
 * derive, so there is no real list to show. These name the rows the section
 * will fill in — read through the same `muscleGroups.*` catalog copy the
 * populated list uses, so the preview never invents a label either. Names
 * only: no bar fill and no number, just the dash.
 */
const EMPTY_MUSCLE_GROUPS: readonly MuscleId[] = [
  'hamstrings',
  'quads',
  'chest',
  'upper_back',
  'side_deltoid',
];

type ExerciseSort = 'recent' | 'mostTrained' | 'heaviest';

const EXERCISE_SORTS: readonly [ExerciseSort, string][] = [
  ['mostTrained', 'progress.loads.filters.mostTrained'],
  ['heaviest', 'progress.loads.filters.heaviest'],
  ['recent', 'progress.loads.filters.recent'],
];

type LooseT = (key: string, options?: Record<string, unknown>) => string;

function localDateAsDate(localDate: string): Date {
  return new Date(`${localDate}T12:00:00`);
}

/** Both dates are anchored at local noon, so DST can never shift the count. */
function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  return Math.round(
    (localDateAsDate(toLocalDate).getTime() - localDateAsDate(fromLocalDate).getTime()) / MS_PER_DAY,
  );
}

function exerciseMaxLoadKg(exercise: ExerciseLoadProgress): number {
  return exercise.history.reduce((best, point) => (point.loadKg > best ? point.loadKg : best), 0);
}

/** Mono cap on the left, optional meta on the right. One per section. */
function Head({ label, meta }: { label: string; meta?: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing[4],
      }}
    >
      <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>{label.toUpperCase()}</MonoLabel>
      {meta ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textMuted }}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

/** Thin proportional bar. Width is relative to the strongest gain on screen. */
function ThinBar({ fraction, active }: { fraction: number; active: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          height: 4,
          borderRadius: 2,
          width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
          backgroundColor: active ? theme.colors.primary : theme.colors.iconMuted,
        }}
      />
    </View>
  );
}

/** Full-width primary action closing an empty state. */
function EmptyCta({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        paddingVertical: 17,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primary,
        opacity: pressed ? opacity.pressed : 1,
      })}
    >
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 16, color: theme.colors.primaryForeground }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The three numbered lines of "Como funciona".
 *
 * Each row is announced as a single "Passo {n}: {texto}" unit so the circled
 * numeral — decoration around an ordinal the text already implies — is never
 * read as a separate element.
 */
function HowItWorksSteps({ steps, stepLabel }: { steps: string[]; stepLabel: (index: number, text: string) => string }) {
  const { theme } = useTheme();
  return (
    <View>
      {steps.map((step, index) => (
        <View
          key={step}
          accessible
          accessibilityLabel={stepLabel(index + 1, step)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[3.5],
            paddingVertical: 13,
            borderTopWidth: index ? sizes.hairline : 0,
            borderTopColor: theme.colors.border,
          }}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: sizes.hairline,
              borderColor: theme.colors.borderStrong,
            }}
          >
            <Text style={{ fontFamily: theme.fonts.mono, fontSize: 10, color: theme.colors.textSubtle }}>
              {index + 1}
            </Text>
          </View>
          <Text style={{ flex: 1, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, color: theme.colors.textEmphasis }}>
            {step}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Cargas with nothing recorded yet.
 *
 * Shows the shape of the real panel — the strength map, how a load becomes a
 * number, and the group rows that will fill in — with every figure left as a
 * dash. No demo series and no sample numbers: the only thing this screen can
 * honestly say before the first workout is what the first workout will
 * produce.
 */
function LoadsEmptyState({
  sex,
  onStartWorkout,
}: {
  sex: Sex | null;
  onStartWorkout?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { t: tWorkout } = useTranslation('workout');
  const { width } = useWindowDimensions();
  const tLoose = t as unknown as LooseT;
  const narrow = width < NARROW_SCREEN;
  const mapSize = narrow ? STRENGTH_MAP_SIZE_NARROW : STRENGTH_MAP_SIZE;
  const groupNameWidth = narrow ? 84 : 96;

  return (
    <View style={{ paddingHorizontal: GUTTER }}>
      {sex ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            marginTop: spacing[8],
            minHeight: 240,
            alignItems: 'center',
            justifyContent: 'flex-end',
            opacity: 0.8,
          }}
        >
          <BodyMuscleMap
            sex={sex}
            primaryMuscles={[]}
            showSecondary={false}
            size={mapSize}
            gap={-mapSize * 0.42}
            frontOffsetX={mapSize * 0.173}
            activeColor={theme.colors.primary}
            baseColor="transparent"
            outlineColor={theme.colors.textEmphasis}
          />
        </View>
      ) : null}

      {/* Without a resolved sex there is no map above, so this block leads
          the panel and takes the lead block's own top margin. */}
      <View style={{ marginTop: sex ? spacing[6] : spacing[8], alignItems: 'center' }}>
        <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>
          {t('progress.loads.empty.eyebrow').toUpperCase()}
        </MonoLabel>
        <Text
          style={{
            marginTop: spacing[3],
            fontFamily: theme.fonts.uiBold,
            fontSize: 22,
            lineHeight: 27.5,
            textAlign: 'center',
            color: theme.colors.textPrimary,
          }}
        >
          {t('progress.loads.empty.title')}
        </Text>
        <Text
          style={{
            marginTop: spacing[2.5],
            fontFamily: theme.fonts.ui,
            fontSize: 14,
            lineHeight: 21.7,
            textAlign: 'center',
            color: theme.colors.textMuted,
          }}
        >
          {t('progress.loads.empty.description')}
        </Text>
      </View>

      {onStartWorkout ? (
        <View style={{ marginTop: 26 }}>
          <EmptyCta label={t('progress.loads.empty.cta')} onPress={onStartWorkout} />
        </View>
      ) : null}

      <View style={{ marginTop: spacing[10] }}>
        <Head label={t('progress.loads.empty.howItWorks')} />
        <HowItWorksSteps
          steps={HOW_IT_WORKS_STEPS.map((step) => tLoose(`progress.loads.empty.steps.${step}`))}
          stepLabel={(number, text) => t('progress.loads.empty.accessibility.step', { number, text })}
        />
      </View>

      <View style={{ marginTop: spacing[10] }}>
        <Head
          label={t('progress.loads.muscleGroups.title')}
          meta={t('progress.loads.empty.noRecords')}
        />
        {EMPTY_MUSCLE_GROUPS.map((muscle, index) => (
          <View
            key={muscle}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[3.5],
              paddingVertical: 13,
              borderTopWidth: index ? sizes.hairline : 0,
              borderTopColor: theme.colors.border,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                width: groupNameWidth,
                fontFamily: theme.fonts.uiSemi,
                fontSize: 14.5,
                color: theme.colors.textMuted,
              }}
            >
              {(tWorkout as unknown as LooseT)(`muscleGroups.${muscle}`, { defaultValue: muscle })}
            </Text>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors.border,
              }}
            />
            <Text
              accessibilityLabel={t('progress.noRecord')}
              style={{
                width: 44,
                textAlign: 'right',
                fontFamily: theme.fonts.ui,
                fontSize: 13.5,
                color: theme.colors.textFaint,
              }}
            >
              {NO_VALUE}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function LoadsEvolutionView({
  exercises,
  recordsLast90Days,
  todayLocalDate,
  loading,
  error,
  onRetry,
  onStartWorkout,
  onSelectExercise,
  sex,
}: {
  exercises: ExerciseLoadProgress[];
  recordsLast90Days: LoadPersonalRecord[];
  todayLocalDate: string;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Starts a workout. Absent when the host cannot drive that flow. */
  onStartWorkout?: () => void;
  /** Opens the full-screen detail for one exercise. */
  onSelectExercise: (exerciseId: string) => void;
  /**
   * Resolved questionnaire sex for the strength map. `null` while it is
   * still unresolved — the map is then dropped entirely rather than falling
   * back to one anatomy.
   */
  sex: Sex | null;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('home');
  const { t: tWorkout } = useTranslation('workout');
  const translateMuscle = (muscle: MuscleId) =>
    (tWorkout as unknown as LooseT)(`muscleGroups.${muscle}`, { defaultValue: muscle });
  const { resolvedUnits } = useUnits();
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId | null>(null);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [sort, setSort] = useState<ExerciseSort>('recent');

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

  /** "há 3 dias" / "há 2 semanas", from the record's own local date. */
  const relativeAge = (localDate: string) => {
    const days = Math.max(0, daysBetween(localDate, todayLocalDate));
    if (days === 0) return t('progress.loads.ago.today');
    if (days < 7) return t('progress.loads.ago.days', { count: days });
    if (days < 28) return t('progress.loads.ago.weeks', { count: Math.floor(days / 7) });
    return t('progress.loads.ago.months', { count: Math.floor(days / 30) });
  };

  const orderedExercises = useMemo(
    () => exercises.slice().sort((a, b) => {
      const aLatest = a.history[a.history.length - 1]?.localDate ?? '';
      const bLatest = b.history[b.history.length - 1]?.localDate ?? '';
      return bLatest.localeCompare(aLatest) || exerciseName(a.exerciseId).localeCompare(exerciseName(b.exerciseId));
    }),
    // The translated catalog name changes with i18n.language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercises, i18n.language],
  );

  // Presentation-only reordering of the exact same list — the chips never
  // filter anything out, they only change the order and which already-known
  // figure each row reports on the right.
  const sortedExercises = useMemo(() => {
    if (sort === 'recent') return orderedExercises;
    return orderedExercises.slice().sort((a, b) => {
      if (sort === 'mostTrained') return b.history.length - a.history.length;
      return exerciseMaxLoadKg(b) - exerciseMaxLoadKg(a);
    });
    // `orderedExercises` (already language-aware) settles every tie.
  }, [orderedExercises, sort]);

  const muscleGains = useMemo(
    () => deriveMuscleGroupLoadGains(exercises, MUSCLE_GROUP_PERIOD, todayLocalDate),
    [exercises, todayLocalDate],
  );

  useEffect(() => {
    if (selectedMuscle && muscleGains.some((gain) => gain.muscle === selectedMuscle)) return;
    setSelectedMuscle(muscleGains[0]?.muscle ?? null);
  }, [muscleGains, selectedMuscle]);

  // Falls back to the top group so the very first frame (before the effect
  // above has set `selectedMuscle`) already shows the map, rather than
  // flashing the section in.
  const activeGain = muscleGains.find((gain) => gain.muscle === selectedMuscle)
    ?? muscleGains[0]
    ?? null;
  const topGainRatio = muscleGains[0]?.gainRatio ?? 0;

  const normalizedQuery = normalizeExerciseSearch(query);
  const searchResults = sortedExercises
    .filter((exercise) => normalizeExerciseSearch(exerciseName(exercise.exerciseId)).includes(normalizedQuery))
    .slice(0, 8);
  const unit = workoutLoadUnit(resolvedUnits);
  const visibleRecords = showAllRecords ? recordsLast90Days : recordsLast90Days.slice(0, 3);

  const formatPercent = (ratio: number) =>
    `${ratio >= 0 ? '+' : '−'}${Math.round(Math.abs(ratio) * 100)}%`;

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
        <Head label={t('progress.loads.eyebrow')} />
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

  /**
   * Strength map + per-group list.
   *
   * Dropped entirely — not shown at 0% — when no muscle group has two
   * comparable points in the window, or while `sex` is unresolved. There is
   * no honest body map to draw in either case.
   */
  const muscleSection = muscleGains.length > 0 && activeGain ? (
    <View>
      {sex ? (
        <View
          accessible
          accessibilityLabel={t('progress.loads.muscleGroups.accessibilityMap', {
            muscle: translateMuscle(activeGain.muscle),
          })}
          style={{ marginTop: spacing[8], minHeight: 240, alignItems: 'center', justifyContent: 'center' }}
        >
          <BodyMuscleMap
            sex={sex}
            primaryMuscles={[activeGain.muscle]}
            showSecondary={false}
            size={STRENGTH_MAP_SIZE}
            gap={-STRENGTH_MAP_SIZE * 0.42}
            frontOffsetX={STRENGTH_MAP_SIZE * 0.173}
            activeColor={theme.colors.primary}
            baseColor="transparent"
            outlineColor={theme.colors.textEmphasis}
          />
        </View>
      ) : null}

      <View style={{ marginTop: spacing[6], paddingHorizontal: GUTTER, alignItems: 'center' }}>
        <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>
          {(activeGain === muscleGains[0]
            ? t('progress.loads.muscleGroups.topEyebrow', { days: MUSCLE_GROUP_PERIOD })
            : t('progress.loads.muscleGroups.eyebrow', { days: MUSCLE_GROUP_PERIOD })).toUpperCase()}
        </MonoLabel>
        <Text
          style={{
            marginTop: spacing[2],
            fontFamily: theme.fonts.uiBold,
            fontSize: 28,
            textAlign: 'center',
            color: theme.colors.textPrimary,
          }}
        >
          {translateMuscle(activeGain.muscle)}
        </Text>
        <Display size={34} color={theme.colors.primaryEmphasis}>
          {formatPercent(activeGain.gainRatio)}
        </Display>
        <Text
          style={{
            marginTop: spacing[1.5],
            textAlign: 'center',
            fontFamily: theme.fonts.ui,
            fontSize: 13,
            color: theme.colors.textMuted,
          }}
        >
          {t('progress.loads.muscleGroups.caption', {
            exercise: exerciseName(activeGain.bestExerciseId),
            load: `${formatWorkoutLoadFromKg(activeGain.bestLoadKg, resolvedUnits)} ${unit}`,
          })}
        </Text>
      </View>

      <View style={{ marginTop: spacing[10], paddingHorizontal: GUTTER }}>
        <Head
          label={t('progress.loads.muscleGroups.title')}
          meta={t('progress.loads.muscleGroups.hint')}
        />
        {muscleGains.map((gain, index) => {
          const isSelected = gain.muscle === activeGain.muscle;
          return (
            <Pressable
              key={gain.muscle}
              onPress={() => setSelectedMuscle(gain.muscle)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t('progress.loads.muscleGroups.accessibilitySelect', {
                muscle: translateMuscle(gain.muscle),
              })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing[3.5],
                paddingVertical: spacing[3],
                borderTopWidth: index ? sizes.hairline : 0,
                borderTopColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  width: 96,
                  fontFamily: theme.fonts.uiSemi,
                  fontSize: 14.5,
                  color: isSelected ? theme.colors.textPrimary : theme.colors.textMuted,
                }}
              >
                {translateMuscle(gain.muscle)}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ThinBar
                  // Relative to the strongest gain on screen; a regression
                  // has no positive length to draw.
                  fraction={topGainRatio > 0 ? gain.gainRatio / topGainRatio : 0}
                  active={isSelected}
                />
              </View>
              <Text
                style={{
                  width: 48,
                  textAlign: 'right',
                  fontFamily: theme.fonts.uiSemi,
                  fontSize: 13.5,
                  color: isSelected ? theme.colors.textPrimary : theme.colors.textMuted,
                }}
              >
                {formatPercent(gain.gainRatio)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  const recordsSection = (
    <View
      accessibilityLabel={t('progress.loads.records90Title')}
      style={{ marginTop: muscleSection ? spacing[10] : spacing[8], paddingHorizontal: GUTTER }}
    >
      <Head
        label={t('progress.loads.recordsTitle')}
        meta={t('progress.loads.records90Meta', { count: recordsLast90Days.length })}
      />
      {visibleRecords.length === 0 ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, color: theme.colors.textMuted }}>
          {t('progress.loads.noRecentRecords')}
        </Text>
      ) : visibleRecords.map((record, index) => {
        const muscle = getExerciseTarget(record.exerciseId)?.primaryMuscle;
        return (
          <Pressable
            key={`${record.executionId}:${record.exerciseId}`}
            onPress={() => onSelectExercise(record.exerciseId)}
            accessibilityRole="button"
            accessibilityLabel={t('progress.loads.accessibility.selectExercise', {
              exercise: exerciseName(record.exerciseId),
            })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[3],
              paddingVertical: spacing[3.5],
              borderTopWidth: index ? sizes.hairline : 0,
              borderTopColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}
              >
                {exerciseName(record.exerciseId)}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  marginTop: spacing[1],
                  fontFamily: theme.fonts.ui,
                  fontSize: 12,
                  color: theme.colors.textFaint,
                }}
              >
                {muscle ? `${translateMuscle(muscle)} · ` : ''}
                {relativeAge(record.localDate)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.textPrimary }}>
                {formatWorkoutLoadFromKg(record.loadKg, resolvedUnits)}{' '}
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
                  {unit}
                </Text>
              </Text>
              <Text
                style={{ fontFamily: theme.fonts.uiSemi, fontSize: 11.5, color: theme.colors.primaryEmphasis }}
              >
                {t('progress.loads.recordGain', {
                  value: formatWorkoutLoadFromKg(record.loadKg - record.previousBestKg, resolvedUnits),
                  unit,
                })}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
          </Pressable>
        );
      })}

      {recordsLast90Days.length > 3 ? (
        <Pressable
          onPress={() => setShowAllRecords((current) => !current)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderTopWidth: sizes.hairline,
            borderTopColor: theme.colors.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <MonoLabel size={9.5} color={theme.colors.primaryEmphasis}>
            {t(showAllRecords ? 'progress.loads.showLess' : 'progress.loads.seeAllRecords').toUpperCase()}
          </MonoLabel>
        </Pressable>
      ) : null}
    </View>
  );

  const panel = (
    <View>
      {muscleSection}
      {recordsSection}

      <View style={{ marginTop: spacing[10], paddingHorizontal: GUTTER }}>
        <Head label={t('progress.loads.exerciseEvolution')} />

        <View
          style={{
            height: 50,
            borderRadius: radii.md,
            borderWidth: sizes.hairline,
            borderColor: searchFocused ? theme.colors.inputBorderFocusStrong : theme.colors.border,
            backgroundColor: theme.colors.surfaceElevated,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing[4],
            gap: spacing[2.5],
          }}
        >
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

        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
          {EXERCISE_SORTS.map(([key, labelKey]) => {
            const active = sort === key;
            const label = t(labelKey as 'progress.loads.filters.recent');
            return (
              <Pressable
                key={key}
                onPress={() => setSort(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t('progress.loads.filters.accessibility', { filter: label })}
                style={({ pressed }) => ({
                  minHeight: 38,
                  paddingHorizontal: spacing[3.5],
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radii.pill,
                  borderWidth: sizes.hairline,
                  borderColor: active ? 'transparent' : theme.colors.borderStrong,
                  backgroundColor: active ? theme.colors.inverseSurface : 'transparent',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 13,
                    color: active ? theme.colors.inverseForeground : theme.colors.textMuted,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: spacing[3] }}>
          {searchResults.length === 0 ? (
            <MonoLabel size={9} style={{ paddingVertical: spacing[3] }}>{t('progress.loads.noExerciseFound')}</MonoLabel>
          ) : searchResults.map((exercise, index) => {
            const latestPoint = exercise.history[exercise.history.length - 1]!;
            const muscle = getExerciseTarget(exercise.exerciseId)?.primaryMuscle;
            // Each chip reports the figure it ordered by — never a number
            // the list isn't actually sorted on.
            const meta = sort === 'mostTrained'
              ? t('progress.loads.sessionsCount', { count: exercise.history.length })
              : sort === 'heaviest'
                ? `${formatWorkoutLoadFromKg(exerciseMaxLoadKg(exercise), resolvedUnits)} ${unit}`
                : dateFormatter.format(localDateAsDate(latestPoint.localDate));
            return (
              <Pressable
                key={exercise.exerciseId}
                onPress={() => { onSelectExercise(exercise.exerciseId); setQuery(''); }}
                accessibilityRole="button"
                accessibilityLabel={t('progress.loads.accessibility.selectExercise', { exercise: exerciseName(exercise.exerciseId) })}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[3],
                  paddingVertical: spacing[3],
                  borderTopWidth: index ? sizes.hairline : 0,
                  borderTopColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: theme.fonts.uiSemi,
                      fontSize: 14.5,
                      color: theme.colors.textPrimary,
                    }}
                  >
                    {exerciseName(exercise.exerciseId)}
                  </Text>
                  {muscle ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        marginTop: spacing[1],
                        fontFamily: theme.fonts.ui,
                        fontSize: 12,
                        color: theme.colors.textFaint,
                      }}
                    >
                      {translateMuscle(muscle)}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted }}>
                  {meta}
                </Text>
                <Icon name="chevron-right" size={16} color={theme.colors.textFaint} />
              </Pressable>
            );
          })}
        </View>

      </View>
    </View>
  );

  // Same condition as before: nothing recorded yet. The panel above has no
  // honest row to draw, so the empty state replaces it entirely rather than
  // standing in front of a demo-fed copy of it.
  if (exercises.length === 0) {
    return <LoadsEmptyState sex={sex} onStartWorkout={onStartWorkout} />;
  }

  return panel;
}
