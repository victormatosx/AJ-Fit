import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EvolutionAreaChart } from './EvolutionAreaChart';
import { Display, MonoLabel, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { AssessmentDelta, AssessmentView } from '../../hooks/useAssessments';
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

interface Props {
  assessments: AssessmentView[];
  loading: boolean;
  error: Error | null;
  latest: AssessmentView | null;
  evolutionSincePrevious: AssessmentDelta | null;
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

export function BodyEvolutionView({
  assessments,
  loading,
  error,
  latest,
  evolutionSincePrevious,
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

  // The hook returns newest first; a chart reads oldest to newest.
  const series = useMemo(
    () =>
      [...assessments]
        .reverse()
        .map((entry) => weightFromKg(entry.weight, resolvedUnits)),
    [assessments, resolvedUnits],
  );

  const bounds = useMemo(() => {
    if (assessments.length < 2) return null;
    const oldest = assessments[assessments.length - 1]!;
    const newest = assessments[0]!;
    return {
      from: dateFormatter.format(oldest.measuredAt.toDate()),
      to: dateFormatter.format(newest.measuredAt.toDate()),
    };
  }, [assessments, dateFormatter]);

  if (loading) {
    return (
      <CenteredState>
        <ActivityIndicator color={theme.colors.textFaint} />
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13, color: theme.colors.textSecondary }}>
          {t('progress.body.loading')}
        </Text>
      </CenteredState>
    );
  }

  if (error) {
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

  if (!latest) {
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

  const measuredAt = dateFormatter.format(latest.measuredAt.toDate());

  return (
    <View>
      {/* Hero: one number carries the screen. */}
      <View style={{ paddingHorizontal: GUTTER }}>
        <Slash style={{ marginBottom: spacing[3] }}>
          {t('progress.body.currentWeight').toUpperCase()}
        </Slash>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
          <Display size={54}>{formatWeightFromKg(latest.weight, resolvedUnits)}</Display>
          <MonoLabel size={12}>{unit.toUpperCase()}</MonoLabel>
          {evolutionSincePrevious ? (
            <View style={{ marginLeft: spacing[1] }}>
              <Delta value={weightFromKg(evolutionSincePrevious.weightDelta, resolvedUnits)} />
            </View>
          ) : null}
        </View>
        <MonoLabel size={9} style={{ marginTop: spacing[1.5] }}>
          {t('progress.body.measuredAt', { date: measuredAt })}
        </MonoLabel>
      </View>

      {/* Chart, or an honest note when a single point cannot draw a curve. */}
      <View style={{ marginTop: spacing[6] }}>
        {series.length >= 2 ? (
          <>
            <View style={{ paddingHorizontal: GUTTER }}>
              <EvolutionAreaChart values={series} />
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

      {/* Composition. Only what the domain actually reports for this entry. */}
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
