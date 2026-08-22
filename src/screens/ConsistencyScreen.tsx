import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { displayLineHeight } from '../theme/tokens';
import { useTheme, type AppTheme } from '../theme';

type Status = 'done' | 'today' | 'missed' | 'pending' | 'rest' | 'restFuture';

const YEAR = 2026;
const DAYS = 31;
const FIRST_WD = 2; // 0=Dom … mês começa numa terça
const TODAY = 16;
const MISSED = [9];

function isTraining(d: number) {
  const wd = (FIRST_WD + d - 1) % 7;
  return [1, 2, 4, 5, 6].includes(wd); // Seg, Ter, Qui, Sex, Sáb
}

function statusOf(d: number): Status {
  if (d === TODAY) return 'today';
  if (d < TODAY) return isTraining(d) ? (MISSED.includes(d) ? 'missed' : 'done') : 'rest';
  return isTraining(d) ? 'pending' : 'restFuture';
}

type CellStyle = {
  background: string | { colors: readonly [string, string] };
  border: string;
  color: string;
};

function cellStyleFor(s: Status, theme: AppTheme): CellStyle {
  switch (s) {
    case 'done':
      return {
        background: theme.chart.consistency.doneBackground,
        border: theme.chart.consistency.doneBorder,
        color: theme.colors.textPrimary,
      };
    case 'today':
      return {
        background: { colors: theme.chart.consistency.todayGradient },
        border: theme.chart.consistency.todayBorder,
        color: theme.colors.primaryForeground,
      };
    case 'missed':
      return {
        background: theme.chart.consistency.missedBackground,
        border: theme.chart.consistency.missedBorder,
        color: theme.chart.consistency.missedText,
      };
    case 'pending':
      return {
        background: theme.colors.surface,
        border: theme.chart.consistency.pendingBorder,
        color: theme.chart.consistency.pendingText,
      };
    case 'rest':
      return { background: 'transparent', border: 'transparent', color: theme.colors.decorativeOutline };
    default:
      return { background: 'transparent', border: 'transparent', color: theme.colors.controlHighlight };
  }
}

function DayCell({ d }: { d: number }) {
  const { theme } = useTheme();
  const s = statusOf(d);
  const cs = cellStyleFor(s, theme);
  const dashed = s === 'pending';
  const isGradient = typeof cs.background !== 'string';

  const inner = (
    <>
      <Text
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 13,
          color: cs.color,
        }}
      >
        {d}
      </Text>
      {s === 'done' && (
        <View
          style={{
            position: 'absolute',
            bottom: 3,
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.chart.consistency.doneMarker,
          }}
        />
      )}
    </>
  );

  const commonWrap = {
    aspectRatio: 1 as const,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    position: 'relative' as const,
    borderWidth: cs.border === 'transparent' ? 0 : 1,
    borderColor: cs.border,
    borderStyle: (dashed ? 'dashed' : 'solid') as 'dashed' | 'solid',
  };

  if (isGradient) {
    const grad = (cs.background as { colors: readonly [string, string] }).colors;
    return (
      <LinearGradient
        colors={grad}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          commonWrap,
          {
            shadowColor: theme.colors.primary,
            shadowOpacity: 0.7,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
            elevation: 6,
          },
        ]}
      >
        {inner}
      </LinearGradient>
    );
  }

  return (
    <View style={[commonWrap, { backgroundColor: cs.background as string }]}>{inner}</View>
  );
}

function LegendChip({ status, label }: { status: Status; label: string }) {
  const { theme } = useTheme();
  const cs = cellStyleFor(status, theme);
  const isGradient = typeof cs.background !== 'string';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      {isGradient ? (
        <LinearGradient
          colors={(cs.background as { colors: readonly [string, string] }).colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            borderWidth: cs.border === 'transparent' ? 0 : 1,
            borderColor: cs.border,
          }}
        />
      ) : (
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            backgroundColor: cs.background as string,
            borderWidth: cs.border === 'transparent' ? 0 : 1,
            borderColor: cs.border,
            borderStyle: status === 'pending' ? 'dashed' : 'solid',
          }}
        />
      )}
      <Text style={{ fontFamily: theme.fonts.ui, fontSize: 11.5, color: theme.colors.textMuted }}>{label}</Text>
    </View>
  );
}

export function ConsistencyScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const daysLeft = DAYS - TODAY;
  let doneCount = 0;
  let pendingCount = 0;
  for (let d = 1; d <= DAYS; d++) {
    const s = statusOf(d);
    if (s === 'done') doneCount++;
    if (s === 'pending') pendingCount++;
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < FIRST_WD; i++) cells.push(null);
  for (let d = 1; d <= DAYS; d++) cells.push(d);
  const dayInitials = t('consistency.dayInitials', { returnObjects: true }) as string[];

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View
          style={{
            paddingHorizontal: 22,
            paddingBottom: 8,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('monthlyConsistency.accessibility.back')}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <MonoLabel>{t('monthlyConsistency.title').toUpperCase()}</MonoLabel>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 14, paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          <Display size={34}>
            {t('monthlyConsistency.monthYear', {
              month: t('monthlyConsistency.month'),
              year: YEAR,
            }).toUpperCase()}
          </Display>

          <LinearGradient
            colors={theme.gradients.accentSummary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginTop: 16,
              padding: 18,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.colors.primaryBorderMuted,
            }}
          >
            <MonoLabel>{t('monthlyConsistency.remainingTitle').toUpperCase()}</MonoLabel>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 20,
                marginTop: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 46,
                    color: theme.colors.textPrimary,
                    lineHeight: displayLineHeight(46),
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {daysLeft}
                </Text>
                <MonoLabel>
                  {t('monthlyConsistency.daysRemaining', { count: daysLeft }).toUpperCase()}
                </MonoLabel>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 6,
                  paddingBottom: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.fonts.display,
                    fontSize: 30,
                    color: theme.chart.consistency.pendingText,
                    lineHeight: displayLineHeight(30),
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {pendingCount}
                </Text>
                <MonoLabel>
                  {t('monthlyConsistency.pendingWorkouts', { count: pendingCount }).toUpperCase()}
                </MonoLabel>
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <SegBar value={TODAY / DAYS} segs={DAYS} />
            </View>
            <MonoLabel style={{ marginTop: 8 }}>
              {t('monthlyConsistency.progress', {
                current: TODAY,
                total: DAYS,
                done: doneCount,
              }).toUpperCase()}
            </MonoLabel>
          </LinearGradient>

          <Card style={{ marginTop: 14, padding: 16 }}>
            <View
              style={{
                flexDirection: 'row',
                marginBottom: 8,
              }}
            >
              {dayInitials.map((w, i) => (
                <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                  <Text
                    style={{
                      fontFamily: theme.fonts.mono,
                      fontSize: 9,
                      color: theme.colors.textFaint,
                      letterSpacing: 1,
                    }}
                  >
                    {w}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {cells.map((d, i) => (
                <View key={i} style={{ width: `${100 / 7}%`, padding: 3 }}>
                  {d === null ? <View style={{ aspectRatio: 1 }} /> : <DayCell d={d} />}
                </View>
              ))}
            </View>
          </Card>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 14,
              marginTop: 16,
              paddingHorizontal: 4,
            }}
          >
            <LegendChip status="done" label={t('monthlyConsistency.legend.done')} />
            <LegendChip status="today" label={t('monthlyConsistency.legend.today')} />
            <LegendChip status="pending" label={t('monthlyConsistency.legend.pending')} />
            <LegendChip status="missed" label={t('monthlyConsistency.legend.missed')} />
            <LegendChip status="rest" label={t('monthlyConsistency.legend.rest')} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBg>
  );
}
