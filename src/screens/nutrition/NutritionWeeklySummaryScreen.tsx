import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../../components/ui/ScreenBg';
import { Display, MonoLabel } from '../../components/ui/Display';
import { Icon } from '../../components/ui/Icon';
import { CtaButton } from '../../components/ui/CtaButton';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { EvolutionAreaChart } from '../../components/fitness/EvolutionAreaChart';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
import type { NutritionTotals } from '../../types/nutrition';
import type { NutritionWeeklyDay, NutritionWeeklySummary, NutritionWeeklyWeightSummary } from '../../nutrition/weekly';

export function NutritionWeeklySummaryScreen({
  summary, weight, loading, weightLoading, error, canGoNext,
  onBack, onPreviousWeek, onNextWeek, onRetry, onOpenProgress,
}: {
  summary: NutritionWeeklySummary | null;
  weight: NutritionWeeklyWeightSummary | null;
  loading: boolean;
  weightLoading: boolean;
  error: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onRetry: () => void;
  onOpenProgress: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const rangeLabel = useMemo(() => summary ? formatWeekRange(summary.weekStartLocalDate, summary.weekEndLocalDate) : '', [summary]);

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 8, gap: 12 }}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('weekly.back')} hitSlop={10} style={{ padding: 4 }}>
            <Icon name="arrow-left" size={20} color={theme.colors.textPrimary} />
          </Pressable>
          <Display size={22} style={{ flex: 1 }}>{t('weekly.title')}</Display>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginTop: 16 }}>
          <Pressable onPress={onPreviousWeek} accessibilityRole="button" accessibilityLabel={t('weekly.previousWeek')} hitSlop={10}>
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>
          <MonoLabel color={theme.colors.textSecondary}>{rangeLabel.toUpperCase()}</MonoLabel>
          <Pressable
            onPress={onNextWeek} disabled={!canGoNext} accessibilityRole="button" accessibilityLabel={t('weekly.nextWeek')}
            hitSlop={10} style={{ opacity: canGoNext ? 1 : theme.opacity.disabled }}
          >
            <Icon name="arrow-right" size={17} color={theme.colors.textPrimary} />
          </Pressable>
        </View>

        {error ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <NutritionErrorState title={t('weekly.loadError')} retryLabel={t('home.errorState.cta')} onRetry={onRetry} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 42, gap: 24 }} showsVerticalScrollIndicator={false}>
            {loading || !summary ? <WeeklySkeleton /> : (
              <>
                <Overview summary={summary} />
                <CaloriesSection summary={summary} />
                <MacrosSection summary={summary} />
                <DaysSection days={summary.days} />
                <WeightSection weight={weight} loading={weightLoading} onOpenProgress={onOpenProgress} />
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function Overview({ summary }: { summary: NutritionWeeklySummary }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  return (
    <Section title={t('weekly.overview')}>
      {summary.recordedDays === 0 ? (
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 13.5, lineHeight: 20, color: theme.colors.textMuted }}>
          {t('weekly.empty')}
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
            <Metric label={t('weekly.loggedDays')} value={t('weekly.daysOfSeven', { count: summary.recordedDays })} />
            <Metric label={t('weekly.meals')} value={`${summary.totalMeals}`} />
          </View>
          <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, lineHeight: 18, color: theme.colors.textMuted }}>
            {summary.recordedDays < 7 ? t('weekly.partial', { count: summary.recordedDays }) : t('weekly.complete')}
          </Text>
          {summary.followedRecommendedMeals > 0 ? (
            <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12.5, color: theme.colors.textSecondary }}>
              {t('weekly.followedRecommended', { count: summary.followedRecommendedMeals })}
            </Text>
          ) : null}
        </>
      )}
    </Section>
  );
}

function CaloriesSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  return (
    <Section title={t('weekly.calories')}>
      <ComparisonRow
        label={t('weekly.averageConsumed')}
        value={summary.averageConsumed?.kcal ?? null}
        target={summary.averageTarget?.kcal ?? null}
        unit={t('weekly.kcalPerDay')}
      />
      {summary.targetDays < 7 ? <CoverageNote summary={summary} /> : null}
    </Section>
  );
}

function MacrosSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  const consumed = summary.averageConsumed;
  const target = summary.averageTarget;
  return (
    <Section title={t('weekly.macros')}>
      <ComparisonRow label={t('weekly.protein')} value={consumed?.proteinG ?? null} target={target?.proteinG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.carbs')} value={consumed?.carbsG ?? null} target={target?.carbsG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.fat')} value={consumed?.fatG ?? null} target={target?.fatG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.fiber')} value={summary.averageFiberG} target={target?.fiberG ?? null} unit={t('weekly.gramsPerDay')} />
      {summary.averageFiberG != null && summary.fiberRecordedDays < summary.recordedDays ? (
        <MutedText>{t('weekly.fiberCoverage', { count: summary.fiberRecordedDays })}</MutedText>
      ) : null}
    </Section>
  );
}

function DaysSection({ days }: { days: NutritionWeeklyDay[] }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const max = Math.max(1, ...days.flatMap((day) => [day.totals?.kcal ?? 0, day.target?.kcal ?? 0]));
  const weekdayLabels = t('weekly.weekdays', { returnObjects: true });
  return (
    <Section title={t('weekly.daysChart')}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: 154 }}>
        {days.map((day, index) => {
          const consumedHeight = day.totals ? Math.max(3, (day.totals.kcal / max) * 104) : 0;
          const targetBottom = day.target ? (day.target.kcal / max) * 104 : null;
          return (
            <View key={day.localDate} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 8, color: theme.colors.textFaint }}>
                {day.totals ? Math.round(day.totals.kcal) : '—'}
              </Text>
              <View style={{ height: 108, width: '100%', justifyContent: 'flex-end', alignItems: 'center', position: 'relative' }}>
                {targetBottom != null ? (
                  <View style={{ position: 'absolute', bottom: targetBottom, width: '100%', height: 1, backgroundColor: theme.colors.textFaint }} />
                ) : null}
                {day.hasLog ? (
                  <View style={{ width: '62%', height: consumedHeight, borderRadius: 5, backgroundColor: theme.colors.primaryEmphasis }} />
                ) : (
                  <View style={{ width: '62%', borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.borderStrong }} />
                )}
              </View>
              <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textMuted }}>
                {weekdayLabels[index]}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Legend color={theme.colors.primaryEmphasis} label={t('weekly.consumedLegend')} />
        <Legend color={theme.colors.textFaint} label={t('weekly.targetLegend')} line />
      </View>
      <MutedText>{t('weekly.noDataLegend')}</MutedText>
    </Section>
  );
}

function WeightSection({ weight, loading, onOpenProgress }: { weight: NutritionWeeklyWeightSummary | null; loading: boolean; onOpenProgress: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' }), []);

  if (loading) return <Section title={t('weekly.weight')}><SkeletonBlock height={150} /></Section>;
  if (!weight?.latest) {
    return (
      <Section title={t('weekly.weight')}>
        <MutedText>{t('weekly.noWeight')}</MutedText>
        <CtaButton ghost onPress={onOpenProgress}>{t('weekly.openProgress')}</CtaButton>
      </Section>
    );
  }
  const delta = weight.deltaKg == null ? null : weightFromKg(weight.deltaKg, resolvedUnits);
  return (
    <Section title={t('weekly.weight')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
        <Metric label={t('weekly.currentWeight')} value={`${formatWeightFromKg(weight.latest.weightKg, resolvedUnits)} ${unit}`} />
        <Metric
          label={t('weekly.previousWeight')}
          value={weight.previous ? `${formatWeightFromKg(weight.previous.weightKg, resolvedUnits)} ${unit}` : '—'}
        />
        <Metric label={t('weekly.variation')} value={delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit}`} />
        <Metric
          label={t('weekly.targetWeight')}
          value={weight.targetWeightKg == null ? '—' : `${formatWeightFromKg(weight.targetWeightKg, resolvedUnits)} ${unit}`}
        />
      </View>
      {weight.points.length >= 2 ? (
        <EvolutionAreaChart
          points={weight.points.map((point) => ({
            value: weightFromKg(point.weightKg, resolvedUnits),
            displayValue: `${formatWeightFromKg(point.weightKg, resolvedUnits)} ${unit.toUpperCase()}`,
            label: dateFormatter.format(point.measuredAt),
          }))}
          accessibilityLabel={t('weekly.weightTrend')}
          accessibilityHint={t('weekly.weightChartHint')}
          height={130}
        />
      ) : <MutedText>{t('weekly.oneWeight')}</MutedText>}
      <MutedText>
        {weight.trendDirection === 'insufficient'
          ? t('weekly.trendLimited', { count: weight.points.length })
          : t('weekly.trendBasedOn', { count: weight.points.length })}
      </MutedText>
      <CtaButton ghost onPress={onOpenProgress}>{t('weekly.openProgress')}</CtaButton>
    </Section>
  );
}

function ComparisonRow({ label, value, target, unit }: { label: string; value: number | null; target: number | null; unit: string }) {
  const { theme } = useTheme();
  const { t } = useTranslation('nutrition');
  const max = Math.max(value ?? 0, target ?? 0, 1);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: theme.fonts.uiSemi, fontSize: 13.5, color: theme.colors.textPrimary }}>{label}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textSecondary }}>
          {t('weekly.consumed')}: {value == null ? '—' : Math.round(value)} {value == null ? '' : unit}
        </Text>
        <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, color: theme.colors.textMuted }}>
          {t('weekly.target')}: {target == null ? '—' : Math.round(target)} {target == null ? '' : unit}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ height: 7, borderRadius: 4, backgroundColor: theme.colors.progressTrack, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.min(100, ((value ?? 0) / max) * 100)}%`, backgroundColor: theme.colors.primaryEmphasis }} />
        </View>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.colors.progressTrack, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.min(100, ((target ?? 0) / max) * 100)}%`, backgroundColor: theme.colors.textFaint }} />
        </View>
      </View>
    </View>
  );
}

function CoverageNote({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  return <MutedText>{t('weekly.targetCoverage', { count: summary.targetDays })}</MutedText>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 14, padding: 16, borderRadius: theme.radii.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.cardBorder }}>
      <MonoLabel color={theme.colors.textSecondary}>{title.toUpperCase()}</MonoLabel>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: '50%' }}>
      <Text style={{ fontFamily: theme.fonts.mono, fontSize: 9, color: theme.colors.textFaint }}>{label.toUpperCase()}</Text>
      <Text style={{ marginTop: 4, fontFamily: theme.fonts.uiBold, fontSize: 17, color: theme.colors.textPrimary }}>{value}</Text>
    </View>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <Text style={{ fontFamily: theme.fonts.ui, fontSize: 12, lineHeight: 18, color: theme.colors.textMuted }}>{children}</Text>;
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 12, height: line ? 1 : 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 10.5, color: theme.colors.textMuted }}>{label}</Text>
    </View>
  );
}

function WeeklySkeleton() {
  return <><SkeletonBlock height={150} /><SkeletonBlock height={130} /><SkeletonBlock height={220} /></>;
}

function formatWeekRange(start: string, end: string): string {
  const toDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const formatter = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });
  return `${formatter.format(toDate(start))} – ${formatter.format(toDate(end))}`;
}
