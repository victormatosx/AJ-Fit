import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { BodyMuscleMap } from './BodyMuscleMap';
import { EvolutionAreaChart } from './EvolutionAreaChart';
import { EvolutionLockedPreview } from './EvolutionLockedPreview';
import { buildDemoAssessments } from './demoAssessmentData';
import { Display, MonoLabel } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { opacity, radii, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { AssessmentDelta, AssessmentView } from '../../hooks/useAssessments';
import type { HealthWeightSampleDoc } from '../../types/healthWeightSync';
import type { SiteKey } from '../../lib/skinfoldCalculator';
import type { MuscleId } from '../../types/exercise';
import type { Sex } from '../../state/AppState';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';

/**
 * The "Corpo" panel of the Evolution screen.
 *
 * Presentation only. Every value comes from `useAssessments`, which the screen
 * owns — this component never reads Firestore, never computes a body metric
 * and never invents one. A metric the domain reports as `null` (an imported
 * assessment with no body-fat estimate, for example) is simply not rendered,
 * rather than shown as a fabricated zero.
 *
 * Visual language: hairline-separated sections, no cards and no surfaces.
 * Each section is a `Head` (mono cap + optional meta) over rows divided by
 * 1px rules — the same grammar the Cargas panel uses.
 */

const GUTTER = sizes.screenGutter;
const MEASUREMENT_SITE_KEYS: readonly SiteKey[] = [
  'chest',
  'axilla',
  'tricep',
  'subscap',
  'abdom',
  'supra',
  'thigh',
];

/**
 * Which muscle the body map highlights for each skinfold site.
 *
 * A skinfold is a fat measurement taken *over* a muscle, so this is a
 * location cue, never a claim about that muscle. `axilla` (mid-axillary
 * line) and `supra` (supra-iliac crest) sit over no muscle the vendored
 * anatomy addresses, so they highlight nothing and the map stays an outline
 * — deliberately, rather than being mapped to the nearest lookalike.
 */
const SITE_MUSCLE: Readonly<Partial<Record<SiteKey, MuscleId>>> = {
  chest: 'chest',
  tricep: 'triceps',
  subscap: 'upper_back',
  abdom: 'abs',
  thigh: 'quads',
};

/** Width of each silhouette in the measurements body map. */
const MEASUREMENT_MAP_SIZE = 112;
/** Same map in the empty state, where it is the section's only drawing. */
const EMPTY_MEASUREMENT_MAP_SIZE = 130;
/** Below this width the empty state steps its map down. */
const NARROW_SCREEN = 360;
const EMPTY_MEASUREMENT_MAP_SIZE_NARROW = 110;
/** Travessão standing in for a figure that does not exist yet. */
const NO_VALUE = '—';
/** Unit every skinfold site is recorded and printed in. */
const MEASUREMENT_UNIT = 'mm';
/** Height of the empty weight chart's ghost grid. */
const GHOST_CHART_HEIGHT = 120;
/** Fractions of that height the three dashed rules sit at. */
const GHOST_CHART_RULES = [0.08, 0.5, 0.92] as const;

function formatMeasurement(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

interface WeightEntry {
  id: string;
  source: 'assessment' | HealthWeightSampleDoc['platform'];
  measuredAt: Date;
  weightKg: number;
}

function assessmentWeightEntries(list: AssessmentView[]): WeightEntry[] {
  return list.map((entry) => ({
    id: `assessment:${entry.id}`,
    source: 'assessment',
    measuredAt: entry.measuredAt.toDate(),
    weightKg: entry.weight,
  }));
}

interface Props {
  assessments: AssessmentView[];
  loading: boolean;
  error: Error | null;
  latest: AssessmentView | null;
  evolutionSincePrevious: AssessmentDelta | null;
  importedWeights: HealthWeightSampleDoc[];
  importedWeightsLoading: boolean;
  importedWeightsError: Error | null;
  onRetry: () => void;
  /** Opens the full assessment area. Absent when the host cannot navigate. */
  onOpenAssessment?: () => void;
  /**
   * Resolved questionnaire sex for the measurements body map. `null` while
   * it is still unresolved — the map is then dropped entirely rather than
   * falling back to one anatomy.
   */
  sex: Sex | null;
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

/**
 * A signed change. Direction is carried by the sign itself and the magnitude
 * is always printed in the accent colour: whether losing or gaining is "good"
 * depends on a goal this screen does not know, so it is not coloured as
 * success or danger.
 */
function Delta({ value, unit, size = 12.5 }: { value: number; unit?: string; size?: number }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  if (value === 0) return null;
  const arrow = value > 0 ? '↑' : '↓';
  const magnitude = Math.abs(value).toFixed(1);
  return (
    <Text
      style={{
        fontFamily: theme.fonts.uiSemi,
        fontSize: size,
        color: theme.colors.primaryEmphasis,
      }}
    >
      {t('progress.body.delta', { direction: arrow, value: magnitude, unit: unit ?? '' }).trim()}
    </Text>
  );
}

/**
 * One column of the composition grid. Rendered only for a metric the
 * assessment actually carries — a `null` never becomes a zero.
 */
function CompositionCell({
  label,
  value,
  unit,
  delta,
  first,
  valueAccessibilityLabel,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
  /** Columns after the first carry the vertical rule that separates them. */
  first: boolean;
  /** Spoken in place of the printed value — used for the empty state's dash. */
  valueAccessibilityLabel?: string;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        paddingHorizontal: spacing[1],
        borderLeftWidth: first ? 0 : sizes.hairline,
        borderLeftColor: theme.colors.border,
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[0.5] }}
        accessible={valueAccessibilityLabel != null}
        accessibilityLabel={valueAccessibilityLabel}
      >
        <Display size={20}>{value}</Display>
        {unit ? (
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
            {unit}
          </Text>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: spacing[1.5],
          fontFamily: theme.fonts.ui,
          fontSize: 11.5,
          color: theme.colors.textMuted,
        }}
      >
        {label}
      </Text>
      {delta != null ? (
        <View style={{ marginTop: spacing[0.5] }}>
          <Delta value={delta} size={11} />
        </View>
      ) : null}
    </View>
  );
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: GUTTER,
        paddingVertical: spacing[12],
        alignItems: 'center',
        gap: spacing[3],
      }}
    >
      {children}
    </View>
  );
}

function ImportedWeightsHistory({ samples }: { samples: HealthWeightSampleDoc[] }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [],
  );
  if (samples.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[10] }}>
      <Head label={t('progress.body.imported.title')} />
      <Text
        style={{
          marginTop: -spacing[2],
          marginBottom: spacing[3],
          fontFamily: theme.fonts.ui,
          fontSize: 12.5,
          lineHeight: 18,
          color: theme.colors.textFaint,
        }}
      >
        {t('progress.body.imported.description')}
      </Text>
      {samples.map((sample, index) => (
        <View
          key={sample.id}
          style={{
            minHeight: 52,
            paddingVertical: spacing[3],
            flexDirection: 'row',
            alignItems: 'center',
            borderTopWidth: index ? sizes.hairline : 0,
            borderTopColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
              {formatter.format(sample.measuredAt)}
            </Text>
            <Text
              style={{
                marginTop: spacing[1],
                fontFamily: theme.fonts.ui,
                fontSize: 12,
                color: theme.colors.textFaint,
              }}
            >
              {t(`progress.body.imported.source.${sample.platform}`)}
            </Text>
          </View>
          <Text style={{ fontFamily: theme.fonts.display, fontSize: 17, color: theme.colors.textPrimary }}>
            {formatWeightFromKg(sample.weightKg, resolvedUnits)}{' '}
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
              {unit}
            </Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

function BodyMeasurementsChart({
  assessments,
  sex,
}: {
  assessments: AssessmentView[];
  sex: Sex | null;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const [selected, setSelected] = useState<SiteKey>(
    () => MEASUREMENT_SITE_KEYS.find((key) =>
      assessments.some((entry) => entry.source === 'guided' && entry.folds[key] != null)) ?? 'chest',
  );
  const displayedUnit = 'mm';

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    [],
  );

  // Oldest-first series for every site at once: the list on the right shows
  // each site's own change, so it cannot be derived from the selected one.
  const seriesBySite = useMemo(() => {
    const chronological = [...assessments].reverse();
    return Object.fromEntries(MEASUREMENT_SITE_KEYS.map((key) => [
      key,
      chronological.flatMap((entry) => {
        const value = entry.source === 'guided' ? entry.folds[key] : undefined;
        return value == null ? [] : [{ value, date: entry.measuredAt.toDate() }];
      }),
    ])) as Record<SiteKey, { value: number; date: Date }[]>;
  }, [assessments]);

  const points = seriesBySite[selected];
  const latestPoint = points[points.length - 1] ?? null;
  const firstPoint = points[0] ?? null;
  const previousPoint = points[points.length - 2] ?? null;
  const delta = latestPoint && previousPoint ? latestPoint.value - previousPoint.value : null;
  const selectedLabel = t(`progress.body.measurements.options.${selected}`);
  const selectedMuscle = SITE_MUSCLE[selected];

  // "Desde" the first date any site was ever recorded — the window the list
  // of per-site changes is read against.
  const since = useMemo(() => {
    const earliest = MEASUREMENT_SITE_KEYS
      .map((key) => seriesBySite[key][0]?.date)
      .filter((date): date is Date => date != null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return earliest ? dateFormatter.format(earliest) : null;
  }, [dateFormatter, seriesBySite]);

  return (
    <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[10] }}>
      <Head
        label={t('progress.body.measurements.title')}
        meta={since ? t('progress.body.measurements.since', { date: since }) : undefined}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
        {sex ? (
          <View
            accessible
            accessibilityLabel={`${t('progress.body.measurements.title')}: ${selectedLabel}`}
            style={{
              // The vendored silhouettes carry a wide empty margin; the
              // negative gap and side margins crop it so the pair reads as
              // one drawing instead of two padded boxes.
              marginLeft: -22,
              marginRight: -14,
            }}
          >
            <BodyMuscleMap
              sex={sex}
              primaryMuscles={selectedMuscle ? [selectedMuscle] : []}
              showSecondary={false}
              size={MEASUREMENT_MAP_SIZE}
              gap={-MEASUREMENT_MAP_SIZE * 0.42}
              activeColor={theme.colors.primary}
              baseColor="transparent"
              outlineColor={theme.colors.textEmphasis}
            />
          </View>
        ) : null}

        <View style={{ flex: 1, minWidth: 0 }}>
          {MEASUREMENT_SITE_KEYS.map((key, index) => {
            const series = seriesBySite[key];
            const siteFirst = series[0] ?? null;
            const siteLatest = series[series.length - 1] ?? null;
            const siteDelta = siteFirst && siteLatest && series.length >= 2
              ? siteLatest.value - siteFirst.value
              : null;
            const isSelected = selected === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSelected(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t('progress.body.measurements.accessibility.option', {
                  measurement: t(`progress.body.measurements.options.${key}`),
                })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing[2],
                  paddingVertical: spacing[3],
                  borderTopWidth: index ? sizes.hairline : 0,
                  borderTopColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flexShrink: 1,
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 14.5,
                    color: isSelected ? theme.colors.textPrimary : theme.colors.textMuted,
                  }}
                >
                  {t(`progress.body.measurements.options.${key}`)}
                </Text>
                <Text
                  style={{
                    flexShrink: 0,
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 12.5,
                    color: isSelected ? theme.colors.primaryEmphasis : theme.colors.textFaint,
                  }}
                >
                  {siteDelta == null
                    ? '—'
                    : `${siteDelta > 0 ? '+' : '−'}${formatMeasurement(Math.abs(siteDelta))} ${displayedUnit}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {latestPoint ? (
        <>
          <View
            style={{
              marginTop: spacing[5.5],
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: spacing[2],
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: theme.fonts.uiBold,
                fontSize: 16,
                color: theme.colors.textPrimary,
              }}
            >
              {selectedLabel}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[1.5] }}>
              {firstPoint && points.length >= 2 ? (
                <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textMuted }}>
                  {formatMeasurement(firstPoint.value)} →
                </Text>
              ) : null}
              <Display size={22}>{formatMeasurement(latestPoint.value)}</Display>
              <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
                {displayedUnit}
              </Text>
              {delta != null ? <Delta value={delta} unit={displayedUnit} size={12} /> : null}
            </View>
          </View>

          {points.length >= 2 ? (
            <>
              <View style={{ marginTop: spacing[4.5] }}>
                <EvolutionAreaChart
                  variant="line"
                  height={110}
                  points={points.map((point) => ({
                    value: point.value,
                    displayValue: `${formatMeasurement(point.value)} ${displayedUnit.toUpperCase()}`,
                    label: dateFormatter.format(point.date),
                  }))}
                  formatAxisValue={formatMeasurement}
                  accessibilityLabel={`${t('progress.body.measurements.title')}: ${selectedLabel}`}
                  accessibilityHint={t('progress.chartInteractionHint')}
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                <AxisDate>{dateFormatter.format(points[0]!.date)}</AxisDate>
                <AxisDate>{dateFormatter.format(latestPoint.date)}</AxisDate>
              </View>
            </>
          ) : (
            <Text
              style={{
                marginTop: spacing[4],
                fontFamily: theme.fonts.ui,
                fontSize: 12.5,
                color: theme.colors.textFaint,
              }}
            >
              {t('progress.body.measurements.singleEntry')}
            </Text>
          )}
        </>
      ) : (
        <Text
          style={{
            marginTop: spacing[4],
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            lineHeight: 18,
            color: theme.colors.textFaint,
          }}
        >
          {t('progress.body.measurements.empty', { measurement: selectedLabel })}
        </Text>
      )}
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
 * The weight chart's placeholder: three dashed rules and the note that says
 * when a curve becomes possible.
 *
 * Drawn with `react-native-svg` rather than dashed borders, which Android
 * renders inconsistently when only one edge is dashed. The note sits on an
 * opaque background chip so it reads as cutting the middle rule, and the
 * whole block is announced as that one sentence — there is no data here to
 * describe.
 */
function GhostChart({ note }: { note: string }) {
  const { theme } = useTheme();
  return (
    <View accessible accessibilityLabel={note} style={{ height: GHOST_CHART_HEIGHT }}>
      <Svg width="100%" height={GHOST_CHART_HEIGHT}>
        {GHOST_CHART_RULES.map((fraction) => (
          <Line
            key={fraction}
            x1="0"
            x2="100%"
            y1={GHOST_CHART_HEIGHT * fraction}
            y2={GHOST_CHART_HEIGHT * fraction}
            stroke={theme.colors.divider}
            strokeWidth={sizes.hairline}
            strokeDasharray="4 4"
          />
        ))}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text
          style={{
            paddingHorizontal: spacing[2.5],
            backgroundColor: theme.colors.background,
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            color: theme.colors.textFaint,
          }}
        >
          {note}
        </Text>
      </View>
    </View>
  );
}

/**
 * Corpo with no assessment and no imported weight yet.
 *
 * Mirrors the real panel section by section — hero weight, weight chart,
 * composition grid, measurements — with every figure left as a dash. The
 * measurement rows name the exact skinfold sites `BodyMeasurementsChart`
 * will chart, so nothing here promises a metric the assessment does not
 * actually collect.
 */
function BodyEmptyState({
  sex,
  onOpenAssessment,
}: {
  sex: Sex | null;
  onOpenAssessment?: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const { width } = useWindowDimensions();
  const unit = weightUnit(resolvedUnits);
  const noRecord = t('progress.noRecord');
  const mapSize = width < NARROW_SCREEN
    ? EMPTY_MEASUREMENT_MAP_SIZE_NARROW
    : EMPTY_MEASUREMENT_MAP_SIZE;

  return (
    <View style={{ paddingHorizontal: GUTTER }}>
      <View style={{ marginTop: spacing[8], alignItems: 'center' }}>
        <MonoLabel size={10} style={{ letterSpacing: 1.6 }}>
          {t('progress.body.currentWeight').toUpperCase()}
        </MonoLabel>
        <View
          accessible
          accessibilityLabel={noRecord}
          style={{ marginTop: spacing[2.5], flexDirection: 'row', alignItems: 'baseline' }}
        >
          <Display size={56} color={theme.colors.emptyIcon}>{NO_VALUE}</Display>
          <Text
            style={{
              marginLeft: spacing[1.5],
              fontFamily: theme.fonts.ui,
              fontSize: 15,
              color: theme.colors.textFaint,
            }}
          >
            {unit}
          </Text>
        </View>
        <Text
          style={{
            marginTop: spacing[4.5],
            fontFamily: theme.fonts.uiBold,
            fontSize: 22,
            lineHeight: 27.5,
            textAlign: 'center',
            color: theme.colors.textPrimary,
          }}
        >
          {t('progress.body.empty.headline')}
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
          {t('progress.body.empty.body')}
        </Text>
      </View>

      {onOpenAssessment ? (
        <View style={{ marginTop: 26 }}>
          <EmptyCta label={t('progress.body.empty.action')} onPress={onOpenAssessment} />
        </View>
      ) : null}

      <View style={{ marginTop: spacing[10] }}>
        <Head label={t('progress.body.empty.weightSection')} />
        <GhostChart note={t('progress.body.empty.chartNote')} />
      </View>

      <View
        accessibilityLabel={t('progress.body.composition')}
        style={{
          marginTop: spacing[8],
          paddingVertical: spacing[3.5],
          flexDirection: 'row',
          borderTopWidth: sizes.hairline,
          borderBottomWidth: sizes.hairline,
          borderColor: theme.colors.border,
        }}
      >
        {([
          ['bodyFat', t('progress.body.metrics.bodyFat')],
          ['leanMass', t('progress.body.metrics.leanMass')],
          ['bmi', t('progress.body.metrics.bmi')],
        ] as const).map(([key, label], index) => (
          <CompositionCell
            key={key}
            label={label}
            value={NO_VALUE}
            unit=""
            first={index === 0}
            valueAccessibilityLabel={noRecord}
          />
        ))}
      </View>

      <View style={{ marginTop: spacing[10] }}>
        <Head
          label={t('progress.body.measurements.title')}
          meta={t('progress.body.empty.noRecords')}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] }}>
          {sex ? (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                // The vendored silhouettes carry a wide empty margin; the
                // negative gap and side margins crop it so the pair reads as
                // one drawing instead of two padded boxes.
                marginLeft: -26,
                marginRight: -18,
                minHeight: 200,
                justifyContent: 'center',
                opacity: 0.8,
              }}
            >
              <BodyMuscleMap
                sex={sex}
                primaryMuscles={[]}
                showSecondary={false}
                size={mapSize}
                gap={-mapSize * 0.42}
                activeColor={theme.colors.primary}
                baseColor="transparent"
                outlineColor={theme.colors.textEmphasis}
              />
            </View>
          ) : null}

          <View style={{ flex: 1, minWidth: 0 }}>
            {MEASUREMENT_SITE_KEYS.map((key, index) => (
              <View
                key={key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  gap: spacing[2],
                  paddingVertical: spacing[3],
                  borderTopWidth: index ? sizes.hairline : 0,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    fontFamily: theme.fonts.uiSemi,
                    fontSize: 14.5,
                    color: theme.colors.textMuted,
                  }}
                >
                  {t(`progress.body.measurements.options.${key}`)}
                </Text>
                <Text
                  accessibilityLabel={noRecord}
                  style={{
                    flexShrink: 0,
                    fontFamily: theme.fonts.ui,
                    fontSize: 12.5,
                    color: theme.colors.textFaint,
                  }}
                >
                  {`${NO_VALUE} ${MEASUREMENT_UNIT}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/** Small date caption under a chart's left/right edge. */
function AxisDate({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textFaint }}>
      {children}
    </Text>
  );
}

export function BodyEvolutionView({
  assessments,
  loading,
  error,
  latest,
  evolutionSincePrevious,
  importedWeights,
  importedWeightsLoading,
  importedWeightsError,
  onRetry,
  onOpenAssessment,
  sex,
}: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    [],
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [],
  );

  // Whether each section has any *real* data to show. `hasRealAssessment`
  // implies `hasAnyRealWeight` — a guided assessment always carries its own
  // weight — so `hasAnyRealWeight` being false also implies no real
  // assessment; the two booleans below partition the panel into exactly
  // three states: nothing real yet (both locked), health-synced weight only
  // (weight real, composition locked), or a real assessment exists (both
  // real, blending in any imported weights too).
  const hasRealAssessment = latest != null;
  const hasImportedWeights = importedWeights.length > 0;
  const hasAnyRealWeight = hasRealAssessment || hasImportedWeights;

  // Demo data backs whichever section(s) above have no real data yet. Built
  // only when needed, and never combined with real assessments or imported
  // weights in the same list — each section is either fully real or fully
  // demo, never a blend of the two.
  const demoAssessments = useMemo(
    () => (hasRealAssessment ? [] : buildDemoAssessments()),
    [hasRealAssessment],
  );

  const realWeightEntries = useMemo(() => {
    const fromAssessments = hasRealAssessment ? assessmentWeightEntries(assessments) : [];
    const assessmentTimestamps = new Set(fromAssessments.map((entry) => entry.measuredAt.getTime()));
    // A health sample sharing the exact timestamp of a real assessment is the
    // same real-world measurement recorded twice; the assessment's own value
    // wins so it isn't double-counted in the combined series.
    const fromHealth: WeightEntry[] = importedWeights
      .filter((entry) => !assessmentTimestamps.has(entry.measuredAt.getTime()))
      .map((entry) => ({
        id: `health:${entry.id}`,
        source: entry.platform,
        measuredAt: entry.measuredAt,
        weightKg: entry.weightKg,
      }));
    return [...fromAssessments, ...fromHealth].sort((a, b) => {
      const byTime = a.measuredAt.getTime() - b.measuredAt.getTime();
      return byTime || a.id.localeCompare(b.id);
    });
  }, [assessments, hasRealAssessment, importedWeights]);

  const demoWeightEntries = useMemo(
    () => assessmentWeightEntries(demoAssessments),
    [demoAssessments],
  );

  const weightEntries = hasAnyRealWeight ? realWeightEntries : demoWeightEntries;

  const weightPoints = useMemo(
    () => weightEntries.map((entry) => ({
      value: weightFromKg(entry.weightKg, resolvedUnits),
      displayValue: `${formatWeightFromKg(entry.weightKg, resolvedUnits)} ${unit.toUpperCase()}`,
      label: dateTimeFormatter.format(entry.measuredAt),
    })),
    [dateTimeFormatter, resolvedUnits, unit, weightEntries],
  );

  const bounds = useMemo(() => {
    if (weightEntries.length < 2) return null;
    const oldest = weightEntries[0]!;
    const newest = weightEntries[weightEntries.length - 1]!;
    return {
      from: dateFormatter.format(oldest.measuredAt),
      to: dateFormatter.format(newest.measuredAt),
    };
  }, [dateFormatter, weightEntries]);

  const latestWeight = weightEntries[weightEntries.length - 1] ?? null;
  const previousWeight = weightEntries[weightEntries.length - 2] ?? null;
  const combinedWeightDelta = latestWeight && previousWeight
    ? latestWeight.weightKg - previousWeight.weightKg
    : null;

  if (loading && importedWeightsLoading) {
    return (
      <CenteredState>
        <ActivityIndicator color={theme.colors.textFaint} />
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondary }}>
          {t('progress.body.loading')}
        </Text>
      </CenteredState>
    );
  }

  if (error && importedWeightsError) {
    return (
      <CenteredState>
        <Text
          style={{
            fontFamily: theme.fonts.ui,
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: 'center',
          }}
        >
          {t('progress.body.error')}
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('progress.body.retry')}
          style={{ paddingVertical: spacing[2.5], paddingHorizontal: spacing[4.5] }}
        >
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
            {t('progress.body.retry')}
          </Text>
        </Pressable>
      </CenteredState>
    );
  }

  if (!latestWeight) {
    // Unreachable: demo entries are non-empty by construction, and
    // `hasAnyRealWeight` is only true when a real assessment or an imported
    // weight actually exists. Kept as a defensive fallback only.
    return null;
  }

  const measuredAt = dateTimeFormatter.format(latestWeight.measuredAt);

  // Composition (body-fat, lean/fat mass, BMI, skinfold measurements) comes
  // exclusively from guided assessments — imported health weight never
  // carries it. So this section locks on `hasRealAssessment` alone, which
  // can diverge from the weight section's own `hasAnyRealWeight` lock
  // whenever the user has synced health weight but never run an assessment.
  const compositionLatest = hasRealAssessment ? latest : demoAssessments[0] ?? null;
  const compositionEvolution = hasRealAssessment ? evolutionSincePrevious : null;
  const compositionAssessments = hasRealAssessment ? assessments : demoAssessments;

  const weightSection = (
    <View>
      {/* Hero: one number carries the screen. */}
      <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[8], alignItems: 'center' }}>
        <MonoLabel size={10} style={{ letterSpacing: 1.6, marginBottom: spacing[2.5] }}>
          {t('progress.body.currentWeight').toUpperCase()}
        </MonoLabel>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Display size={56}>{formatWeightFromKg(latestWeight.weightKg, resolvedUnits)}</Display>
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
            textAlign: 'center',
            fontFamily: theme.fonts.ui,
            fontSize: 13,
            color: theme.colors.textMuted,
          }}
        >
          {combinedWeightDelta != null && bounds ? (
            <>
              <Text style={{ fontFamily: theme.fonts.uiSemi, color: theme.colors.primaryEmphasis }}>
                {`${combinedWeightDelta > 0 ? '+' : '−'}${Math.abs(weightFromKg(combinedWeightDelta, resolvedUnits)).toFixed(1)} ${unit}`}
              </Text>
              {` ${t('progress.body.sinceMeasured', { from: bounds.from, measured: measuredAt })}`}
            </>
          ) : (
            t('progress.body.measuredAt', { date: measuredAt })
          )}
        </Text>
        <Text
          style={{
            marginTop: spacing[1],
            fontFamily: theme.fonts.ui,
            fontSize: 12,
            color: theme.colors.textFaint,
          }}
        >
          {latestWeight.source === 'assessment'
            ? t('progress.body.weightSource.assessment')
            : t(`progress.body.imported.source.${latestWeight.source}`)}
        </Text>
      </View>

      {/* Chart, or an honest note when a single point cannot draw a curve. */}
      <View style={{ marginTop: spacing[6], paddingHorizontal: GUTTER }}>
        {weightPoints.length >= 2 ? (
          <>
            <EvolutionAreaChart
              variant="line"
              height={160}
              points={weightPoints}
              formatAxisValue={(value) => value.toFixed(1)}
              accessibilityLabel={t('progress.body.currentWeight')}
              accessibilityHint={t('progress.chartInteractionHint')}
            />
            {bounds ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: spacing[2],
                }}
              >
                <AxisDate>{bounds.from}</AxisDate>
                <AxisDate>{bounds.to}</AxisDate>
              </View>
            ) : null}
          </>
        ) : (
          <Text
            style={{
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              color: theme.colors.textFaint,
            }}
          >
            {t('progress.body.singleEntry')}
          </Text>
        )}
      </View>
    </View>
  );

  // Only the metrics this assessment actually carries. `null` is absence,
  // never zero — an imported assessment with no body-fat estimate simply
  // contributes no column.
  const compositionCells = compositionLatest ? [
    compositionLatest.bodyFat != null ? {
      key: 'bodyFat',
      label: t('progress.body.metrics.bodyFat'),
      value: compositionLatest.bodyFat.toFixed(1),
      unit: '%',
      delta: compositionEvolution?.bodyFatDelta ?? null,
    } : null,
    compositionLatest.leanMass != null ? {
      key: 'leanMass',
      label: t('progress.body.metrics.leanMass'),
      value: formatWeightFromKg(compositionLatest.leanMass, resolvedUnits),
      unit,
      delta: compositionEvolution?.leanMassDelta != null
        ? weightFromKg(compositionEvolution.leanMassDelta, resolvedUnits)
        : null,
    } : null,
    compositionLatest.fatMass != null ? {
      key: 'fatMass',
      label: t('progress.body.metrics.fatMass'),
      value: formatWeightFromKg(compositionLatest.fatMass, resolvedUnits),
      unit,
      delta: compositionEvolution?.fatMassDelta != null
        ? weightFromKg(compositionEvolution.fatMassDelta, resolvedUnits)
        : null,
    } : null,
    compositionLatest.bmi != null ? {
      key: 'bmi',
      label: t('progress.body.metrics.bmi'),
      value: compositionLatest.bmi.toFixed(1),
      unit: '',
      delta: null,
    } : null,
  ].flatMap((cell) => (cell ? [cell] : [])) : [];

  const compositionSection = compositionLatest ? (
    <View>
      {compositionCells.length > 0 ? (
        <View
          accessibilityLabel={t('progress.body.composition')}
          style={{
            marginTop: spacing[9],
            marginHorizontal: GUTTER,
            paddingVertical: spacing[3.5],
            flexDirection: 'row',
            borderTopWidth: sizes.hairline,
            borderBottomWidth: sizes.hairline,
            borderColor: theme.colors.border,
          }}
        >
          {compositionCells.map((cell, index) => (
            <CompositionCell
              key={cell.key}
              label={cell.label}
              value={cell.value}
              unit={cell.unit}
              delta={cell.delta}
              first={index === 0}
            />
          ))}
        </View>
      ) : null}

      <BodyMeasurementsChart assessments={compositionAssessments} sex={sex} />
    </View>
  ) : null;

  // `hasAnyRealWeight` false implies `hasRealAssessment` false too (see the
  // comment above both flags), so when the weight section has no real data,
  // neither does composition: the whole panel becomes the empty state, which
  // prints the shape of every section with a dash where each figure lands.
  // Same condition as before — only what it renders changed.
  if (!hasAnyRealWeight) {
    return <BodyEmptyState sex={sex} onOpenAssessment={onOpenAssessment} />;
  }

  return (
    <View>
      {weightSection}

      {importedWeightsError ? (
        <Text
          accessibilityRole="alert"
          style={{
            paddingHorizontal: GUTTER,
            marginTop: spacing[5],
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            color: theme.colors.textFaint,
          }}
        >
          {t('progress.body.imported.error')}
        </Text>
      ) : null}
      <ImportedWeightsHistory samples={importedWeights} />

      {/* Composition still has no real data (e.g. health weight is synced
          but no assessment was ever done): lock just this sub-section,
          sized to its own demo content rather than the full screen. */}
      {hasRealAssessment ? (
        compositionSection
      ) : (
        <EvolutionLockedPreview
          title={t('progress.body.empty.title')}
          description={t('progress.body.empty.description')}
          ctaLabel={onOpenAssessment ? t('progress.body.empty.cta') : undefined}
          onPress={onOpenAssessment}
          fillHeight={false}
        >
          {compositionSection}
        </EvolutionLockedPreview>
      )}

      {onOpenAssessment && hasRealAssessment ? (
        <View style={{ paddingHorizontal: GUTTER, marginTop: spacing[10] }}>
          <Pressable
            onPress={onOpenAssessment}
            accessibilityRole="button"
            accessibilityLabel={t('progress.body.openAssessment')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing[2],
              paddingVertical: spacing[4],
              borderRadius: radii.md,
              borderWidth: sizes.hairline,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.surfacePressed,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14.5, color: theme.colors.textPrimary }}>
              {t('progress.body.openAssessment')}
            </Text>
            <Icon name="chevron-right" size={16} color={theme.colors.textMuted} />
          </Pressable>
          {latest ? (
            <Text
              style={{
                marginTop: spacing[3],
                textAlign: 'center',
                fontFamily: theme.fonts.ui,
                fontSize: 12,
                color: theme.colors.textFaint,
              }}
            >
              {t('progress.body.lastAssessment', {
                date: dateFormatter.format(latest.measuredAt.toDate()),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
