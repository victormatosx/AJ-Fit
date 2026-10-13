import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EvolutionAreaChart } from './EvolutionAreaChart';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { AssessmentDelta, AssessmentView } from '../../hooks/useAssessments';
import type { HealthWeightSampleDoc } from '../../types/healthWeightSync';
import type { SiteKey } from '../../lib/skinfoldCalculator';
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

function formatMeasurement(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
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
}

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

/**
 * A signed change. Direction is shown with an arrow and the magnitude is
 * printed unsigned, always in the accent colour: whether losing or gaining is
 * "good" depends on a goal this screen does not know, so it is not coloured
 * as success or danger.
 */
function Delta({ value, unit }: { value: number; unit?: string }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  if (value === 0) return null;
  const arrow = value > 0 ? '↑' : '↓';
  const magnitude = Math.abs(value).toFixed(1);
  return (
    <Text style={{ fontFamily: theme.fonts.mono, fontSize: 11, color: theme.colors.primaryEmphasis }}>
      {t('progress.body.delta', { direction: arrow, value: magnitude, unit: unit ?? '' }).trim()}
    </Text>
  );
}

function MetricRow({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingVertical: spacing[3],
        paddingHorizontal: GUTTER,
      }}
    >
      <MonoLabel style={{ flex: 1 }}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
        <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>{value}</Text>
        <MonoLabel size={9}>{unit}</MonoLabel>
        {delta != null ? <Delta value={delta} /> : null}
      </View>
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
    <View>
      <View style={{ paddingHorizontal: GUTTER, marginBottom: spacing[2] }}>
        <Slash>{t('progress.body.imported.title').toUpperCase()}</Slash>
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textFaint, marginTop: spacing[2] }]}>
          {t('progress.body.imported.description')}
        </Text>
      </View>
      {samples.map((sample, index) => (
        <View
          key={sample.id}
          style={{
            minHeight: 52,
            marginHorizontal: GUTTER,
            paddingVertical: spacing[2.5],
            flexDirection: 'row',
            alignItems: 'center',
            borderTopWidth: index ? sizes.hairline : 0,
            borderTopColor: theme.colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
              {formatter.format(sample.measuredAt)}
            </Text>
            <MonoLabel size={8} style={{ marginTop: spacing[1] }}>
              {t(`progress.body.imported.source.${sample.platform}`)}
            </MonoLabel>
          </View>
          <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 15, color: theme.colors.textPrimary }}>
            {formatWeightFromKg(sample.weightKg, resolvedUnits)} {unit.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BodyMeasurementsChart({ assessments }: { assessments: AssessmentView[] }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const [selected, setSelected] = useState<SiteKey>(
    () => MEASUREMENT_SITE_KEYS.find((key) =>
      assessments.some((entry) => entry.source === 'guided' && entry.folds[key] != null)) ?? 'chest',
  );
  const [open, setOpen] = useState(false);
  const displayedUnit = 'mm';

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    [],
  );

  const points = useMemo(
    () =>
      [...assessments]
        .reverse()
        .flatMap((entry) => {
          const value = entry.source === 'guided' ? entry.folds[selected] : undefined;
          return value == null
            ? []
            : [{
                value,
                date: entry.measuredAt.toDate(),
              }];
        }),
    [assessments, selected],
  );

  const latestPoint = points[points.length - 1] ?? null;
  const previousPoint = points[points.length - 2] ?? null;
  const delta = latestPoint && previousPoint ? latestPoint.value - previousPoint.value : null;
  const selectedLabel = t(`progress.body.measurements.options.${selected}`);

  return (
    <View style={{ paddingHorizontal: GUTTER }}>
      <Slash style={{ marginBottom: spacing[3] }}>
        {t('progress.body.measurements.title').toUpperCase()}
      </Slash>

      <View style={{ position: 'relative' }}>
        <Pressable
          onPress={() => setOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={t('progress.body.measurements.accessibility.select')}
          accessibilityState={{ expanded: open }}
          style={{
            minHeight: 48,
            paddingHorizontal: spacing[4],
            borderRadius: 12,
            borderWidth: 1,
            borderColor: open ? theme.colors.primaryBorderMuted : theme.colors.borderStrong,
            backgroundColor: theme.colors.surfaceElevated,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <MonoLabel size={8}>{t('progress.body.measurements.selectLabel').toUpperCase()}</MonoLabel>
            <Text
              style={{
                marginTop: spacing[1],
                fontFamily: theme.fonts.uiSemi,
                fontSize: 14,
                color: theme.colors.textPrimary,
              }}
            >
              {selectedLabel}
            </Text>
          </View>
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Icon name="chevron-down" size={17} color={theme.colors.primaryEmphasis} />
          </View>
        </Pressable>

        {open ? (
          <View
            style={{
              marginTop: spacing[2],
              borderRadius: 12,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.floatingSurface,
            }}
          >
            {MEASUREMENT_SITE_KEYS.map((key, index) => {
              const isSelected = selected === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    setSelected(key);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t('progress.body.measurements.accessibility.option', {
                    measurement: t(`progress.body.measurements.options.${key}`),
                  })}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: spacing[4],
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTopWidth: index ? sizes.hairline : 0,
                    borderTopColor: theme.colors.sheetDivider,
                    backgroundColor: isSelected ? theme.colors.choiceSelectedBackground : 'transparent',
                  }}
                >
                  <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13, color: theme.colors.textPrimary }}>
                    {t(`progress.body.measurements.options.${key}`)}
                  </Text>
                  {isSelected ? <Icon name="check" size={14} color={theme.colors.primaryEmphasis} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {latestPoint ? (
        <>
          <View style={{ marginTop: spacing[5], flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
            <Display size={42}>
              {formatMeasurement(latestPoint.value)}
            </Display>
            <MonoLabel size={11}>{displayedUnit.toUpperCase()}</MonoLabel>
            {delta != null ? <Delta value={delta} unit={displayedUnit} /> : null}
          </View>

          {points.length >= 2 ? (
            <>
              <View style={{ marginTop: spacing[4] }}>
                <EvolutionAreaChart
                  points={points.map((point) => ({
                    value: point.value,
                    displayValue: `${formatMeasurement(point.value)} ${displayedUnit.toUpperCase()}`,
                    label: dateFormatter.format(point.date),
                  }))}
                  accessibilityLabel={`${t('progress.body.measurements.title')}: ${selectedLabel}`}
                  accessibilityHint={t('progress.chartInteractionHint')}
                />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                <MonoLabel size={9}>{dateFormatter.format(points[0]!.date)}</MonoLabel>
                <MonoLabel size={9}>{dateFormatter.format(latestPoint.date)}</MonoLabel>
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

  const weightEntries = useMemo(() => [
    ...assessments.map((entry) => ({
      id: `assessment:${entry.id}`,
      source: 'assessment' as const,
      measuredAt: entry.measuredAt.toDate(),
      weightKg: entry.weight,
    })),
    ...importedWeights.map((entry) => ({
      id: `health:${entry.id}`,
      source: entry.platform,
      measuredAt: entry.measuredAt,
      weightKg: entry.weightKg,
    })),
  ].sort((a, b) => {
    const byTime = a.measuredAt.getTime() - b.measuredAt.getTime();
    return byTime || a.id.localeCompare(b.id);
  }), [assessments, importedWeights]);

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
    return (
      <CenteredState>
        <Icon name="chart" size={26} color={theme.colors.textFaint} />
        <Display size={20} style={{ textAlign: 'center' }}>
          {t('progress.body.empty.title')}
        </Display>
        <Text
          style={{
            fontFamily: theme.fonts.ui,
            fontSize: 13,
            lineHeight: 19,
            color: theme.colors.textMuted,
            textAlign: 'center',
          }}
        >
          {t('progress.body.empty.description')}
        </Text>
        {onOpenAssessment ? (
          <Pressable
            onPress={onOpenAssessment}
            accessibilityRole="button"
            accessibilityLabel={t('progress.body.empty.cta')}
            style={{
              marginTop: spacing[2],
              paddingVertical: spacing[3],
              paddingHorizontal: spacing[5],
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.borderStrong,
              backgroundColor: theme.colors.surfaceElevated,
            }}
          >
            <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 14, color: theme.colors.textPrimary }}>
              {t('progress.body.empty.cta')}
            </Text>
          </Pressable>
        ) : null}
      </CenteredState>
    );
  }

  const measuredAt = dateTimeFormatter.format(latestWeight.measuredAt);

  return (
    <View>
      {/* Hero: one number carries the screen. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>
          {t('progress.body.currentWeight').toUpperCase()}
        </Slash>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
          <Display size={54}>{formatWeightFromKg(latestWeight.weightKg, resolvedUnits)}</Display>
          <MonoLabel size={12}>{unit.toUpperCase()}</MonoLabel>
          {combinedWeightDelta != null ? (
            <View style={{ marginLeft: spacing[1] }}>
              <Delta value={weightFromKg(combinedWeightDelta, resolvedUnits)} />
            </View>
          ) : null}
        </View>
        <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
          {t('progress.body.measuredAt', { date: measuredAt })}
        </MonoLabel>
        <MonoLabel size={8} style={{ marginTop: spacing[1] }}>
          {latestWeight.source === 'assessment'
            ? t('progress.body.weightSource.assessment')
            : t(`progress.body.imported.source.${latestWeight.source}`)}
        </MonoLabel>
      </View>

      {/* Chart, or an honest note when a single point cannot draw a curve. */}
      <View style={{ marginTop: spacing[6] }}>
        {weightPoints.length >= 2 ? (
          <>
            <View style={{ paddingHorizontal: GUTTER }}>
              <EvolutionAreaChart
                points={weightPoints}
                accessibilityLabel={t('progress.body.currentWeight')}
                accessibilityHint={t('progress.chartInteractionHint')}
              />
            </View>
            {bounds ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: GUTTER,
                  marginTop: spacing[2],
                }}
              >
                <MonoLabel size={9}>{bounds.from}</MonoLabel>
                <MonoLabel size={9}>{bounds.to}</MonoLabel>
              </View>
            ) : null}
          </>
        ) : (
          <Text
            style={{
              paddingHorizontal: GUTTER,
              fontFamily: theme.fonts.ui,
              fontSize: 12.5,
              color: theme.colors.textFaint,
            }}
          >
            {t('progress.body.singleEntry')}
          </Text>
        )}
      </View>

      <Rule />

      {importedWeightsError ? (
        <Text
          accessibilityRole="alert"
          style={{
            paddingHorizontal: GUTTER,
            marginBottom: spacing[4],
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            color: theme.colors.textFaint,
          }}
        >
          {t('progress.body.imported.error')}
        </Text>
      ) : null}
      <ImportedWeightsHistory samples={importedWeights} />
      {importedWeights.length > 0 ? <Rule /> : null}

      {/* Composition. Only what the domain actually reports for this entry. */}
      {latest ? (
        <>
          <View style={{ paddingHorizontal: GUTTER, marginBottom: spacing[1] }}>
            <Slash>{t('progress.body.composition').toUpperCase()}</Slash>
          </View>

          {latest.bodyFat != null ? (
            <MetricRow
              label={t('progress.body.metrics.bodyFat')}
              value={latest.bodyFat.toFixed(1)}
              unit="%"
              delta={evolutionSincePrevious?.bodyFatDelta ?? null}
            />
          ) : null}
          {latest.leanMass != null ? (
            <MetricRow
              label={t('progress.body.metrics.leanMass')}
              value={formatWeightFromKg(latest.leanMass, resolvedUnits)}
              unit={unit}
              delta={
                evolutionSincePrevious?.leanMassDelta != null
                  ? weightFromKg(evolutionSincePrevious.leanMassDelta, resolvedUnits)
                  : null
              }
            />
          ) : null}
          {latest.fatMass != null ? (
            <MetricRow
              label={t('progress.body.metrics.fatMass')}
              value={formatWeightFromKg(latest.fatMass, resolvedUnits)}
              unit={unit}
              delta={
                evolutionSincePrevious?.fatMassDelta != null
                  ? weightFromKg(evolutionSincePrevious.fatMassDelta, resolvedUnits)
                  : null
              }
            />
          ) : null}
          {latest.bmi != null ? (
            <MetricRow
              label={t('progress.body.metrics.bmi')}
              value={latest.bmi.toFixed(1)}
              unit=""
            />
          ) : null}

          <Rule />
          <BodyMeasurementsChart assessments={assessments} />
        </>
      ) : (
        <View style={{ paddingHorizontal: GUTTER, alignItems: 'center', gap: spacing[2] }}>
          <Display size={18} style={{ textAlign: 'center' }}>{t('progress.body.empty.title')}</Display>
          <Text style={[theme.typography.bodySmall, { color: theme.colors.textMuted, textAlign: 'center' }]}>
            {t('progress.body.imported.noAssessment')}
          </Text>
        </View>
      )}

      {onOpenAssessment ? (
        <>
          <Rule />
          <Pressable
            onPress={onOpenAssessment}
            accessibilityRole="button"
            accessibilityLabel={t('progress.body.openAssessment')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginHorizontal: GUTTER,
              paddingVertical: spacing[3.5],
            }}
          >
            <MonoLabel color={theme.colors.textPrimary}>
              {t('progress.body.openAssessment').toUpperCase()}
            </MonoLabel>
            <Icon name="chevron-right" size={16} color={theme.colors.primaryEmphasis} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
