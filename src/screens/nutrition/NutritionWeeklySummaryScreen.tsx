import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NutritionErrorState } from '../../components/nutrition/NutritionStates';
import { SkeletonBlock } from '../../components/nutrition/NutritionPrimitives';
import { EvolutionAreaChart } from '../../components/fitness/EvolutionAreaChart';
import { NU, NuButton, NuCap, NuHairline, NuNav, NuRing, NuSheetHeader, NuThinBar } from '../../components/nutrition/NuKit';
import { useUnits } from '../../state/UnitsContext';
import { formatWeightFromKg, weightFromKg, weightUnit } from '../../units/weightConversions';
import { isFutureLocalDate, todayLocalDate } from '../../nutrition/ui/localDate';
import { displayLineHeight } from '../../theme/tokens';
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
  const { t } = useTranslation('nutrition');
  const rangeLabel = useMemo(() => summary ? formatWeekRange(summary.weekStartLocalDate, summary.weekEndLocalDate) : '', [summary]);

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
            label={canGoNext ? t('weekly.thisWeek') : rangeLabel}
            sub={rangeLabel}
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
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 30, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
          >
            {loading || !summary ? <WeeklySkeleton /> : (
              <>
                <Overview summary={summary} />
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

function Overview({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  if (summary.recordedDays === 0) {
    return (
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 13.5, lineHeight: 20, color: NU.faint, marginBottom: 20 }}>
        {t('weekly.empty')}
      </Text>
    );
  }
  return (
    <View style={{ alignItems: 'center', marginBottom: 30 }}>
      <NuRing size={170} stroke={11} pct={summary.averageTarget?.kcal ? ((summary.averageConsumed?.kcal ?? 0) / summary.averageTarget.kcal) * 100 : 0}>
        <NuCap>{t('weekly.averageConsumed')}</NuCap>
        <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 42, lineHeight: displayLineHeight(42), color: NU.white, marginTop: 8, textTransform: 'uppercase' }}>
          {Math.round(summary.averageConsumed?.kcal ?? 0)}
        </Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint, marginTop: 6 }}>
          {t('home.summary.of')} {Math.round(summary.averageTarget?.kcal ?? 0)} {t('units.kcal')}
        </Text>
      </NuRing>
      <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: NU.white, marginTop: 18, textAlign: 'center' }}>
        {summary.recordedDays < 7 ? t('weekly.partial', { count: summary.recordedDays }) : t('weekly.complete')}
      </Text>
      <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.faint, marginTop: 6, textAlign: 'center' }}>
        {t('weekly.daysOfSeven', { count: summary.recordedDays })}
      </Text>
      {summary.followedRecommendedMeals > 0 ? (
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12.5, color: NU.secondary, marginTop: 4, textAlign: 'center' }}>
          {t('weekly.followedRecommended', { count: summary.followedRecommendedMeals })}
        </Text>
      ) : null}
    </View>
  );
}

function CaloriesSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  return (
    <SectionBlock title={t('weekly.calories')}>
      <ComparisonRow
        label={t('weekly.averageConsumed')}
        value={summary.averageConsumed?.kcal ?? null}
        target={summary.averageTarget?.kcal ?? null}
        unit={t('weekly.kcalPerDay')}
        last
      />
      {summary.targetDays < 7 ? <MutedText>{t('weekly.targetCoverage', { count: summary.targetDays })}</MutedText> : null}
    </SectionBlock>
  );
}

function MacrosSection({ summary }: { summary: NutritionWeeklySummary }) {
  const { t } = useTranslation('nutrition');
  const consumed = summary.averageConsumed;
  const target = summary.averageTarget;
  return (
    <SectionBlock title={t('weekly.macros')}>
      <ComparisonRow label={t('weekly.protein')} value={consumed?.proteinG ?? null} target={target?.proteinG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.carbs')} value={consumed?.carbsG ?? null} target={target?.carbsG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.fat')} value={consumed?.fatG ?? null} target={target?.fatG ?? null} unit={t('weekly.gramsPerDay')} />
      <ComparisonRow label={t('weekly.fiber')} value={summary.averageFiberG} target={target?.fiberG ?? null} unit={t('weekly.gramsPerDay')} last={summary.averageFiberG == null || summary.fiberRecordedDays >= summary.recordedDays} />
      {summary.averageFiberG != null && summary.fiberRecordedDays < summary.recordedDays ? (
        <MutedText>{t('weekly.fiberCoverage', { count: summary.fiberRecordedDays })}</MutedText>
      ) : null}
    </SectionBlock>
  );
}

/** §4.2 "DIA A DIA" — a thin-bar row per day, not the old vertical column chart. */
function DaysSection({ days }: { days: NutritionWeeklyDay[] }) {
  const { t } = useTranslation('nutrition');
  const max = Math.max(1, ...days.flatMap((day) => [day.totals?.kcal ?? 0, day.target?.kcal ?? 0]));
  const weekdayLabels = t('weekly.weekdays', { returnObjects: true }) as unknown as string[];
  const today = todayLocalDate();
  return (
    <SectionBlock title={t('weekly.daysChart')}>
      {days.map((day, index) => {
        const future = isFutureLocalDate(day.localDate);
        const tickPct = day.target ? Math.min(100, (day.target.kcal / max) * 100) : undefined;
        return (
          <View key={day.localDate} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11 }}>
            <Text style={{ width: 34, fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: day.localDate === today ? NU.white : future ? NU.faintest : NU.secondary }}>
              {weekdayLabels?.[index] ?? ''}
            </Text>
            <View style={{ flex: 1 }}>
              {day.hasLog && day.totals
                ? <NuThinBar value={day.totals.kcal} max={max} color={day.localDate === today ? NU.blueHi : NU.strong} tickPct={tickPct} />
                : <NuThinBar value={0} max={1} tickPct={tickPct} dashed />}
            </View>
            <Text style={{ width: 84, textAlign: 'right', fontFamily: 'Archivo_400Regular', fontSize: 13, color: day.totals ? NU.white : NU.faintest }}>
              {day.totals ? `${Math.round(day.totals.kcal)} ${t('units.kcal')}` : '—'}
            </Text>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <View style={{ width: 1.5, height: 10, backgroundColor: 'rgba(255,255,255,0.5)' }} />
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faintest }}>{t('weekly.targetLegend')}</Text>
      </View>
      <MutedText>{t('weekly.noDataLegend')}</MutedText>
    </SectionBlock>
  );
}

function WeightSection({ weight, loading, onOpenProgress }: { weight: NutritionWeeklyWeightSummary | null; loading: boolean; onOpenProgress: () => void }) {
  const { t } = useTranslation('nutrition');
  const { resolvedUnits } = useUnits();
  const unit = weightUnit(resolvedUnits);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' }), []);

  if (loading) return <SectionBlock title={t('weekly.weight')} last><SkeletonBlock height={150} /></SectionBlock>;
  if (!weight?.latest) {
    return (
      <SectionBlock title={t('weekly.weight')} last>
        <MutedText>{t('weekly.noWeight')}</MutedText>
        <NuButton ghost onPress={onOpenProgress} style={{ marginTop: 14 }}>{t('weekly.openProgress')}</NuButton>
      </SectionBlock>
    );
  }
  const delta = weight.deltaKg == null ? null : weightFromKg(weight.deltaKg, resolvedUnits);
  return (
    <SectionBlock title={t('weekly.weight')} last>
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
          height={130}
        />
      ) : <MutedText>{t('weekly.oneWeight')}</MutedText>}
      <MutedText>
        {weight.trendDirection === 'insufficient'
          ? t('weekly.trendLimited', { count: weight.points.length })
          : t('weekly.trendBasedOn', { count: weight.points.length })}
      </MutedText>
      <NuButton ghost onPress={onOpenProgress} style={{ marginTop: 14 }}>{t('weekly.openProgress')}</NuButton>
    </SectionBlock>
  );
}

function ComparisonMetricsRow({ weight, delta, unit, resolvedUnits }: {
  weight: NutritionWeeklyWeightSummary; delta: number | null; unit: string; resolvedUnits: Parameters<typeof formatWeightFromKg>[1];
}) {
  const { t } = useTranslation('nutrition');
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, marginBottom: 16 }}>
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

function ComparisonRow({ label, value, target, unit, last }: { label: string; value: number | null; target: number | null; unit: string; last?: boolean }) {
  const { t } = useTranslation('nutrition');
  const max = Math.max(value ?? 0, target ?? 0, 1);
  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: NU.hairline, gap: 8 }}>
      <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: NU.white }}>{label}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.secondary }}>
          {t('weekly.consumed')}: {value == null ? '—' : Math.round(value)} {value == null ? '' : unit}
        </Text>
        <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, color: NU.faint }}>
          {t('weekly.target')}: {target == null ? '—' : Math.round(target)} {target == null ? '' : unit}
        </Text>
      </View>
      <NuThinBar value={value ?? 0} max={max} tickPct={target != null ? Math.min(100, (target / max) * 100) : undefined} />
    </View>
  );
}

function SectionBlock({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <View style={{ marginBottom: last ? 40 : 0 }}>
      <NuCap style={{ marginBottom: 12 }}>{title}</NuCap>
      {children}
      {!last ? <NuHairline style={{ marginTop: 24, marginBottom: 24 }} /> : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%' }}>
      <NuCap>{label}</NuCap>
      <Text style={{ marginTop: 4, fontFamily: 'Archivo_700Bold', fontSize: 17, color: NU.white }}>{value}</Text>
    </View>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'Archivo_400Regular', fontSize: 12, lineHeight: 18, color: NU.faint, marginTop: 10 }}>{children}</Text>;
}

function WeeklySkeleton() {
  return <View style={{ gap: 20 }}><SkeletonBlock height={150} /><SkeletonBlock height={130} /><SkeletonBlock height={220} /></View>;
}

function formatWeekRange(start: string, end: string): string {
  const toDate = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const formatter = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' });
  return `${formatter.format(toDate(start))} – ${formatter.format(toDate(end))}`;
}
