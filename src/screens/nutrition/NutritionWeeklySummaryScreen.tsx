import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { EvolutionAreaChart } from '../../components/fitness/EvolutionAreaChart';
import { NU, NuButton, NuCap, NuNav, NuSheetHeader } from '../../components/nutrition/NuKit';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
import { isFutureLocalDate, todayLocalDate } from '../../nutrition/ui/localDate';
import { displayLineHeight, palette } from '../../theme/tokens';
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
  const { t, i18n } = useTranslation('nutrition');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const rangeLabel = useMemo(() => summary ? formatWeekRange(summary.weekStartLocalDate, summary.weekEndLocalDate, locale) : '', [summary, locale]);

  return (
    <View style={{ flex: 1, backgroundColor: NU.bg }}>
      {/*
        `edges={['top']}` only — no `'bottom'`. This screen's content area
        is NOT behind AppShell's tab bar: in AppShell.tsx, the tab content
        `<View style={{flex:1}}>` and `<TabBar>` are flex SIBLINGS in the
        same column, so Yoga already sizes the content view to exactly
        "screen height minus the tab bar's own (already safe-area-padded)
        height" — nothing left to compensate for here. Adding a `'bottom'`
        edge on top of that double-reserves the device's home-indicator
        inset (it's already spent once, inside the tab bar's own
        `SafeAreaView edges={['bottom']}`), which is what was pushing this
        screen's content away from the tab bar with dead empty space.
      */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <NuSheetHeader title={t('weekly.title')} onBack={onBack} />

        <View style={{ paddingHorizontal: 24 }}>
          <NuNav
            label={rangeLabel || t('weekly.thisWeek')}
            onPrev={onPreviousWeek}
            onNext={onNextWeek}
            nextDisabled={!canGoNext}
          />
        </View>

        {error ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <NutritionErrorState title={t('weekly.loadError')} retryLabel={t('home.errorState.cta')} onRetry={onRetry} />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            // Plain bottom breathing room for the last section — the
            // ScrollView's own `flex: 1` already bounds it to exactly the
            // space above the tab bar (see the SafeAreaView comment above),
            // so this isn't compensating for anything hidden underneath it.
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 20, gap: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {loading || !summary ? <WeeklySkeleton /> : (
              <>
                <CaloriesSection summary={summary} />
                <DaysSection days={summary.days} />
                <MacrosSection summary={summary} />
                <WeightSection weight={weight} loading={weightLoading} onOpenProgress={onOpenProgress} />
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Ratios are presentation-only; persisted averages and targets remain authoritative. */
function progressPercent(value: number | null, target: number | null): number | null {
  return value != null && target != null && target > 0 ? Math.max(0, value / target * 100) : null;
}

function WeeklyBar({ value, target, color, label }: { value: number | null; target: number | null; color: string; label: string }) {
  const percent = progressPercent(value, target);
  return (
    <View accessibilityRole={percent == null ? undefined : 'progressbar'} accessibilityLabel={label}
      accessibilityValue={percent == null ? undefined : { min: 0, max: 100, now: Math.round(Math.min(100, percent)) }}
      style={{ height: 5, borderRadius: 3, backgroundColor: NU.track, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${Math.min(100, percent ?? 0)}%`, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

function CaloriesSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  const value = summary.averageConsumed?.kcal ?? null;
  const target = summary.averageTarget?.kcal ?? null;
  const percent = progressPercent(value, target);
  const targets = summary.days.flatMap((day) => day.target ? [day.target.kcal] : []);
  const varies = new Set(targets).size > 1;
  return (
    <SectionBlock title={t('weekly.dailyAverage')} trailing={(
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('weekly.aboutAverage')}
          onPress={() => Alert.alert(t('weekly.dailyAverage'), [
            summary.recordedDays === 0 ? t('weekly.empty') : t('weekly.averageCoverage', { count: summary.recordedDays }),
            summary.targetDays < 7 ? t('weekly.targetCoverage', { count: summary.targetDays }) : null,
          ].filter(Boolean).join('\n\n'))}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginVertical: -8, marginRight: -8 }}
        >
          <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: NU.secondary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'Archivo_700Bold', fontSize: 12, lineHeight: 15, color: NU.secondary }}>!</Text>
          </View>
        </Pressable>
    )}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 24, rowGap: 12 }}>
        <View style={{ flexGrow: 1, minWidth: 115 }}>
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 42, lineHeight: displayLineHeight(42), color: NU.white }}>
            {value == null ? '—' : Math.round(value)}
            <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 16, color: NU.secondary }}> {t('units.kcal')}</Text>
          </Text>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 18, color: NU.secondary, marginTop: 3 }}>
            {target == null ? t('weekly.targetUnavailable') : `${t('home.summary.of')} ${Math.round(target)} ${t('units.kcal')}`}
          </Text>
        </View>
        <View style={{ flexBasis: '48%', flexGrow: 1, minWidth: 140, gap: 6 }}>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.secondary, textAlign: 'right' }}>
            {t(varies ? 'weekly.averageDailyTarget' : 'weekly.dailyTarget')}
          </Text>
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.strong, textAlign: 'right' }}>
            {target == null ? '—' : `${Math.round(target)} ${t('units.kcal')}`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <View style={{ flex: 1 }}><WeeklyBar value={value} target={target} color={NU.blueHi} label={t('weekly.calories')} /></View>
            <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: NU.white }}>{percent == null ? '—' : `${Math.round(percent)}%`}</Text>
          </View>
        </View>
      </View>
      {summary.recordedDays === 0 || summary.followedRecommendedMeals > 0 ? (
        <MutedText>{summary.recordedDays === 0 ? t('weekly.empty') : t('weekly.followedRecommended', { count: summary.followedRecommendedMeals })}</MutedText>
      ) : null}
    </SectionBlock>
  );
}

function MacrosSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  const consumed = summary.averageConsumed;
  const target = summary.averageTarget;
  const targetsVary = new Set(summary.days.flatMap((day) => day.target ? [JSON.stringify(day.target)] : [])).size > 1;
  const rows = [
    { label: t('weekly.protein'), value: consumed?.proteinG ?? null, target: target?.proteinG ?? null, color: NU.blueHi },
    { label: t('weekly.carbs'), value: consumed?.carbsG ?? null, target: target?.carbsG ?? null, color: palette.green400 },
    { label: t('weekly.fat'), value: consumed?.fatG ?? null, target: target?.fatG ?? null, color: palette.amber500 },
    { label: t('weekly.fiber'), value: summary.averageFiberG, target: target?.fiberG ?? null, color: '#a78bfa' },
  ];
  return (
    <SectionBlock title={t('weekly.macroAverages')}>
      {rows.map((row, index) => <ComparisonRow key={row.label} {...row} last={index === rows.length - 1} />)}
      {targetsVary ? <MutedText>{t('weekly.macroTargetsAverage', { count: summary.targetDays })}</MutedText> : null}
      {summary.averageFiberG != null && summary.fiberRecordedDays < summary.recordedDays ? (
        <MutedText>{t('weekly.fiberCoverage', { count: summary.fiberRecordedDays })}</MutedText>
      ) : null}
    </SectionBlock>
  );
}

/** One common scale preserves comparisons between days; absent logs are never plotted as zero. */
function DaysSection({ days }: { days: NutritionWeeklyDay[] }) {
  const { t } = useTranslation('nutrition');
  const { fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(0);
  const max = Math.max(1, ...days.flatMap((day) => [day.hasLog && day.totals ? day.totals.kcal : 0, day.target?.kcal ?? 0])) * 1.2;
  const knownTargets = days.flatMap((day) => day.target ? [day.target.kcal] : []);
  const commonTarget = knownTargets.length === days.length && new Set(knownTargets).size === 1 && knownTargets[0] > 0 ? knownTargets[0] : null;
  const weekdayLabels = t('weekly.weekdays', { returnObjects: true }) as unknown as string[];
  const today = todayLocalDate();
  return (
    <SectionBlock title={t('weekly.dailyConsumption')} trailing={<Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.secondary }}>{t('units.kcal')}</Text>}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}>
        <View style={{ width: Math.max(availableWidth, 280 * fontScale), paddingTop: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {days.map((day, index) => {
              const future = isFutureLocalDate(day.localDate);
              const value = day.hasLog && day.totals ? day.totals.kcal : null;
              const target = day.target?.kcal ?? null;
              const current = day.localDate === today;
              const label = weekdayLabels?.[index] ?? '';
              return (
                <View key={day.localDate} accessible
                  accessibilityLabel={`${label}, ${day.localDate}: ${value == null ? t(future ? 'weekly.futureDay' : 'weekly.noRecordDay') : `${Math.round(value)} ${t('units.kcal')}`}. ${target == null ? t('weekly.targetUnavailable') : `${t('weekly.target')}: ${Math.round(target)} ${t('units.kcal')}`}`}
                  style={{ flex: 1, minWidth: 0, alignItems: 'center', opacity: future ? 0.4 : 1 }}>
                  <View style={{ height: 112, width: '70%', borderRadius: 5, backgroundColor: NU.surfaceSubtleStrong, overflow: 'hidden' }}>
                    {value != null ? <View style={{ position: 'absolute', bottom: 0, width: '100%', height: `${Math.max(0, Math.min(100, value / max * 100))}%`, borderRadius: 5, backgroundColor: NU.blueHi }} /> : null}
                    {commonTarget == null && target != null && target > 0 ? (
                      <View style={{ position: 'absolute', left: 0, right: 0, bottom: `${Math.min(100, target / max * 100)}%`, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: NU.secondary }} />
                    ) : null}
                  </View>
                  <Text style={{ fontFamily: current ? 'Archivo_700Bold' : 'Archivo_400Regular', fontSize: 11, color: current ? NU.white : NU.secondary, marginTop: 8 }}>{label}</Text>
                  <Text style={{ fontFamily: current ? 'Archivo_700Bold' : 'Archivo_400Regular', fontSize: 11, color: current ? NU.white : NU.secondary, marginTop: 3 }}>{value == null ? '—' : Math.round(value)}</Text>
                </View>
              );
            })}
          </View>
          {commonTarget != null ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 8 + 112 * (1 - commonTarget / max), borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: NU.secondary }} />
          ) : null}
        </View>
      </ScrollView>
    </SectionBlock>
  );
}

function WeightSection({ weight, loading, onOpenProgress }: { weight: NutritionWeeklyWeightSummary | null; loading: boolean; onOpenProgress: () => void }) {
  const { t, i18n } = useTranslation('nutrition');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }), [locale]);

  if (loading) return <SectionBlock title={t('weekly.weight')}><SkeletonBlock height={72} /></SectionBlock>;
  if (!weight?.latest) {
    return (
      <SectionBlock title={t('weekly.weight')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          <Text style={{ flexBasis: '50%', flexGrow: 1, minWidth: 130, fontFamily: 'Archivo_400Regular', fontSize: 13, lineHeight: 19, color: NU.secondary }}>{t('weekly.noWeeklyWeight')}</Text>
          <NuButton ghost onPress={onOpenProgress}>{t('weekly.openProgressCompact')}</NuButton>
        </View>
      </SectionBlock>
    );
  }
  const delta = weight.deltaKg == null ? null : weightFromKg(weight.deltaKg, resolvedUnits);
  return (
    <SectionBlock title={t('weekly.weight')}>
      <ComparisonMetricsRow weight={weight} delta={delta} unit={unit} resolvedUnits={resolvedUnits} />
      {weight.points.length >= 2 ? (
        <EvolutionAreaChart
          points={weight.points.map((point) => ({
            value: weightFromKg(point.weightKg, resolvedUnits),
            displayValue: `${formatWeightFromKg(point.weightKg, resolvedUnits)} ${unit.toUpperCase()}`,
            label: dateFormatter.format(point.measuredAt),
          }))}
          accessibilityLabel={t('weekly.weightTrend')}
          accessibilityHint={t('weekly.weightChartHint')}
          height={110}
        />
      ) : <MutedText>{t('weekly.oneWeight')}</MutedText>}
      <MutedText>
        {weight.trendDirection === 'insufficient'
          ? t('weekly.trendLimited', { count: weight.points.length })
          : t('weekly.trendBasedOn', { count: weight.points.length })}
      </MutedText>
      <NuButton ghost onPress={onOpenProgress} style={{ marginTop: 12, alignSelf: 'flex-start' }}>{t('weekly.openProgressCompact')}</NuButton>
    </SectionBlock>
  );
}

function ComparisonMetricsRow({ weight, delta, unit, resolvedUnits }: {
  weight: NutritionWeeklyWeightSummary; delta: number | null; unit: string; resolvedUnits: Parameters<typeof formatWeightFromKg>[1];
}) {
  const { t } = useTranslation('nutrition');
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, marginBottom: 8 }}>
      <Metric label={t('weekly.currentWeight')} value={`${formatWeightFromKg(weight.latest!.weightKg, resolvedUnits)} ${unit}`} />
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
  );
}

function ComparisonRow({ label, value, target, color, last }: { label: string; value: number | null; target: number | null; color: string; last?: boolean }) {
  const { t } = useTranslation('nutrition');
  const percent = progressPercent(value, target);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 8, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: NU.hairline }}>
      <View style={{ flexBasis: '45%', flexGrow: 1, minWidth: 120, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginTop: 4 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, lineHeight: 19, color: NU.white }}>{label}</Text>
          <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 17, color: NU.secondary }}>
            {value == null ? '—' : `${Math.round(value)} ${t('units.gramsShort')}`} {t('home.summary.of')} {target == null ? '—' : `${Math.round(target)} ${t('units.gramsShort')}`}
          </Text>
        </View>
      </View>
      <View style={{ flexBasis: '40%', flexGrow: 1, minWidth: 105, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}><WeeklyBar value={value} target={target} color={color} label={label} /></View>
        <Text style={{ minWidth: 34, textAlign: 'right', fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.secondary }}>{percent == null ? '—' : `${Math.round(percent)}%`}</Text>
      </View>
    </View>
  );
}

function SectionBlock({ title, children, trailing }: { title: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <View style={{ padding: 16, borderRadius: 16, backgroundColor: NU.surfaceSubtle, borderWidth: 1, borderColor: NU.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <NuCap style={{ flex: 1 }}>{title}</NuCap>
        {trailing}
      </View>
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%' }}>
      <NuCap>{label}</NuCap>
      <Text style={{ marginTop: 4, fontFamily: 'Archivo_700Bold', fontSize: 15, color: NU.white }}>{value}</Text>
    </View>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 18, color: NU.secondary, marginTop: 8 }}>{children}</Text>;
}

function WeeklySkeleton() {
  return <View style={{ gap: 16 }}><SkeletonBlock height={130} /><SkeletonBlock height={210} /><SkeletonBlock height={250} /><SkeletonBlock height={100} /></View>;
}

function formatWeekRange(start: string, end: string, locale: string): string {
  const toDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const formatter = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' });
  return `${formatter.format(toDate(start))} – ${formatter.format(toDate(end))}`;
}
