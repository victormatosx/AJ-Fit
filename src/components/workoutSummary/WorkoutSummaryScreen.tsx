import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CtaButton } from '../ui/CtaButton';
import { Display, MonoLabel } from '../ui/Display';
import { Icon, type IconName } from '../ui/Icon';
import { useTheme } from '../../theme';
import { sizes, spacing } from '../../theme/tokens';
import { useUnits } from '../../state/UnitsContext';
import { formatWorkoutLoadFromKg, workoutLoadUnit } from '../../units/workoutLoadConversions';
import { formatWorkoutShareDuration } from '../../workoutShare/data';
import type { WorkoutSummaryData } from '../../workoutSummary/buildWorkoutSummaryData';
import { AssessmentMetricCard } from '../fitness/AssessmentMetricCard';
import { MusclesWorkedSection } from './MusclesWorkedSection';
import { PersonalRecordsSection } from './PersonalRecordsSection';
import { WorkoutHighlightsSection } from './WorkoutHighlightsSection';
import { WorkoutPulseSection } from './WorkoutPulseSection';

const FOOTER_HEIGHT = sizes.controlLg;

function CompletionHero({ data }: { data: WorkoutSummaryData }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  if (!data.completion) return null;
  const percentage = Math.round(data.completion.percentageBasisPoints / 100);

  return (
    <View
      style={{
        marginTop: spacing[5],
        padding: spacing[5],
        borderRadius: 18,
        borderBottomRightRadius: 2,
        borderWidth: 1,
        borderColor: theme.colors.primaryBorderQuiet,
        backgroundColor: theme.colors.primarySurfaceSubtle,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] }}>
        <Display size={44} color={theme.colors.primaryEmphasis}>{`${percentage}%`}</Display>
        <MonoLabel size={10}>{t('done.summary.completion.label').toUpperCase()}</MonoLabel>
      </View>
      <Text style={{ marginTop: spacing[1], color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13 }}>
        {t('done.summary.completion.sets', {
          completed: data.completion.completedSets,
          planned: data.completion.plannedSets,
        })}
      </Text>
      <View style={{ height: 5, marginTop: spacing[3], borderRadius: 3, overflow: 'hidden', backgroundColor: theme.colors.controlBackground }}>
        <View style={{ width: `${percentage}%`, height: '100%', backgroundColor: theme.colors.primaryEmphasis }} />
      </View>
      {data.finalizedEarly || data.cardioSkipped ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
          {data.finalizedEarly ? (
            <MonoLabel size={8.5} color={theme.colors.textMuted}>
              {t('done.summary.completion.earlyBadge').toUpperCase()}
            </MonoLabel>
          ) : null}
          {data.cardioSkipped ? (
            <MonoLabel size={8.5} color={theme.colors.textMuted}>
              {t('done.summary.completion.cardioSkippedBadge').toUpperCase()}
            </MonoLabel>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PersonalRecordCircle({ count }: { count: number }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const hasRecords = count > 0;

  return (
    <View style={{ alignItems: 'center', marginTop: spacing[5], marginBottom: spacing[6] }}>
      <View
        style={{
          width: 148,
          height: 148,
          borderRadius: 74,
          borderWidth: 2,
          borderColor: hasRecords ? theme.colors.primaryEmphasis : theme.colors.border,
          backgroundColor: hasRecords ? theme.colors.primarySurfaceSubtle : theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasRecords ? (
          <>
            <Display size={52} color={theme.colors.primaryEmphasis}>{String(count)}</Display>
            <MonoLabel size={9} style={{ marginTop: 6 }}>
              {t('done.summary.personalRecordsCount', { count }).toUpperCase()}
            </MonoLabel>
          </>
        ) : (
          <>
            <Icon name="trophy" size={26} color={theme.colors.textFaint} />
            <MonoLabel size={8.5} style={{ marginTop: 8, textAlign: 'center', maxWidth: 110 }}>
              {t('done.summary.noRecordsTitle').toUpperCase()}
            </MonoLabel>
          </>
        )}
      </View>
      {!hasRecords ? (
        <Text
          style={{
            marginTop: spacing[2],
            fontFamily: theme.fonts.ui,
            fontSize: 12.5,
            color: theme.colors.textMuted,
            textAlign: 'center',
            maxWidth: 240,
          }}
        >
          {t('done.summary.noRecordsSubtitle')}
        </Text>
      ) : null}
    </View>
  );
}

function SummaryMetricsGrid({ data }: { data: WorkoutSummaryData }) {
  const { t } = useTranslation('workout');
  const { resolvedUnits } = useUnits();
  const unit = workoutLoadUnit(resolvedUnits);

  const items: { label: string; value: string; unit?: string; icon: IconName }[] = [
    { label: t('done.summary.metrics.records'), value: String(data.personalRecordCount), icon: 'trophy' },
    { label: t('done.summary.metrics.volume'), value: formatWorkoutLoadFromKg(data.volumeKg, resolvedUnits), unit, icon: 'dumbbell' },
    { label: t('done.summary.metrics.sets'), value: String(data.completedSetCount), icon: 'list' },
    { label: t('done.summary.metrics.reps'), value: String(data.totalReps), icon: 'target' },
  ];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] }}>
      {items.map((item) => (
        <AssessmentMetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          unit={item.unit}
          icon={item.icon}
          size="lg"
          style={{ flexBasis: '47%', flexGrow: 1 }}
        />
      ))}
    </View>
  );
}

function localDateLabel(localDate: string, locale: string): string {
  const date = new Date(`${localDate}T12:00:00`);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date);
}

export function WorkoutSummaryScreen({
  data,
  onClose,
  onShare,
}: {
  data: WorkoutSummaryData;
  onClose: () => void;
  onShare: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('workout');
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('done.summary.closeAccessibility')}
              onPress={onClose}
              hitSlop={6}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="x" size={18} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 17, letterSpacing: 0.8 }}>
              {t('done.kicker').toUpperCase()}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: sizes.screenGutter,
              paddingTop: spacing[2],
              paddingBottom: FOOTER_HEIGHT + insets.bottom + spacing[6],
            }}
            showsVerticalScrollIndicator={false}
          >
            <Display size={28} numberOfLines={2}>{data.workoutName}</Display>
            <MonoLabel size={11} style={{ marginTop: spacing[1] }}>
              {localDateLabel(data.performedLocalDate, i18n.language)} · {formatWorkoutShareDuration(data.durationSeconds)}
            </MonoLabel>

            <CompletionHero data={data} />

            <PersonalRecordCircle count={data.personalRecordCount} />

            <SummaryMetricsGrid data={data} />

            <WorkoutPulseSection pulse={data.pulse} />

            <PersonalRecordsSection
              personalRecords={data.personalRecords}
              currentBests={data.currentBests}
              performedAnyLoadBasedExercise={data.hasLoadBasedData}
            />

            <MusclesWorkedSection bodyMap={data.bodyMap} />

            <WorkoutHighlightsSection highlights={data.highlights} />
          </ScrollView>

          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: sizes.screenGutter,
              paddingTop: spacing[3],
              paddingBottom: insets.bottom + spacing[3],
              backgroundColor: theme.colors.background,
              borderTopWidth: sizes.hairline,
              borderTopColor: theme.colors.border,
            }}
          >
            <CtaButton onPress={onShare}>{t('done.summary.shareCta')}</CtaButton>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
