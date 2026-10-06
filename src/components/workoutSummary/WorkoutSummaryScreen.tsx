import { useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { CtaButton } from '../ui/CtaButton';
import { Display, MonoLabel } from '../ui/Display';
import { Icon, type IconName } from '../ui/Icon';
import { RiseIn } from '../ui/RiseIn';
import { useTheme } from '../../theme';
import { sizes, spacing } from '../../theme/tokens';
import { useUnits } from '../../state/UnitsContext';
import { formatWorkoutVolumeFromKg, workoutVolumeUnit } from '../../units/workoutLoadConversions';
import { formatWorkoutShareDuration } from '../../workoutShare/data';
import type { WorkoutSummaryData } from '../../workoutSummary/buildWorkoutSummaryData';
import type { Sex } from '../../state/AppState';
import { AssessmentMetricCard } from '../fitness/AssessmentMetricCard';
import { MusclesWorkedSection } from './MusclesWorkedSection';
import { PersonalRecordsSection } from './PersonalRecordsSection';
import { WorkoutHighlightsSection } from './WorkoutHighlightsSection';
import { WorkoutPulseSection } from './WorkoutPulseSection';
import { FinalizationProgressRing, type FinalizationRingPhase } from './FinalizationProgressRing';
import type { WorkoutFinalizationProgressStage } from '../../workoutLifecycle/finalizationProgress';
import { useFinalizationMessageKey } from '../../workoutSummary/useFinalizationMessageKey';
import type { WorkoutSummaryLoadProgressStatus } from '../../loadProgress/workoutSummaryRefresh';
import type { WorkoutFinalizationErrorCategory } from '../../workoutLifecycle/finalizationErrorClassification';

const FOOTER_HEIGHT = sizes.controlLg;

/**
 * OFFLINE/TIMEOUT/CARDIO_COMPLETION_REQUIRED each get distinct copy — the
 * first two tell the user something concrete and actionable ("check your
 * connection" / "this can take a bit, it's safe to retry"); the cardio one
 * names the actual blocker instead of a generic failure, since a plain retry
 * can never resolve it on its own. VALIDATION and UNKNOWN both fall back to
 * the original generic message: a business-rule rejection is never explained
 * in Firebase terms to the user, and an unclassified error has nothing
 * honest to add beyond "didn't work, retry".
 */
function finishFailedMessageKey(
  category: WorkoutFinalizationErrorCategory | null,
): 'done.finishFailedOffline' | 'done.finishFailedTimeout' | 'done.finishFailedCardioRequired' | 'done.finishFailed' {
  switch (category) {
    case 'OFFLINE': return 'done.finishFailedOffline';
    case 'TIMEOUT': return 'done.finishFailedTimeout';
    case 'CARDIO_COMPLETION_REQUIRED': return 'done.finishFailedCardioRequired';
    default: return 'done.finishFailed';
  }
}

/** Crossfades in whenever `text` changes — snaps to invisible first, then
 * eases in, so a message swap never flashes the old and new copy together. */
function FadeMessageText({ text, style }: { text: string; style: Record<string, unknown> }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) });
  }, [text, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.Text style={[style, animatedStyle]}>{text}</Animated.Text>;
}

// Explicit, shared line heights for every slot below the ring whose content
// can change — not an approximation of some native default, a value THIS
// code defines and applies identically to every variant that can occupy the
// slot. That's what makes the reservation exact rather than guessed: the
// message row's `minHeight` always matches what every one of its possible
// contents (the rotating message, the "X of Y sets" text, or nothing) was
// itself given as `lineHeight`, and likewise for the badge row.
const MESSAGE_LINE_HEIGHT = 18;
const BADGE_ROW_LINE_HEIGHT = 14;

function FinalizationMessage({ active }: { active: boolean }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const messageKey = useFinalizationMessageKey(active);
  return (
    <FadeMessageText
      text={t(`done.summary.finalization.messages.${messageKey}`)}
      style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: MESSAGE_LINE_HEIGHT, textAlign: 'center' }}
    />
  );
}

function CompletionHero({
  data,
  committed,
  failed,
  retrying,
}: {
  data: WorkoutSummaryData | null;
  committed: boolean;
  failed: boolean;
  /** A new attempt is in flight after a previous one failed — same ring animation as the first try, distinct label only, so the user can tell the tap registered. */
  retrying: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  // Visual-only phase — deliberately decoupled from the real server
  // checkpoints (`finalizationProgress.ts`), which keep driving
  // observability/recovery and never pixels directly. The ring itself
  // animates continuously on Reanimated's UI thread for whichever phase
  // it's told (see `FinalizationProgressRing.tsx`).
  const phase: FinalizationRingPhase = failed ? 'failed' : committed ? 'completing' : 'ramping';
  const label = t(committed
    ? 'done.summary.finalization.committed'
    : failed ? 'done.summary.finalization.interrupted'
      : retrying ? 'done.summary.finalization.retrying' : 'done.summary.finalization.processing');

  return (
    <View style={{ marginTop: spacing[5], paddingVertical: spacing[2], alignItems: 'center' }}>
      <FinalizationProgressRing phase={phase} size={188} label={label} accessibilityLabel={label} />
      {/* Both the rotating message and the "X of Y sets" text that replaces
          it once `data.completion` arrives use the exact same `lineHeight`
          (`MESSAGE_LINE_HEIGHT`) — and this slot is always rendered, at that
          same `minHeight`, even while showing neither — so the swap between
          them (and EARLY/cardio's local `data.completion` becoming available
          only once the execution is adopted post-commit) never changes this
          row's height, which would otherwise push the cards below down. */}
      <View style={{ marginTop: spacing[3], minHeight: MESSAGE_LINE_HEIGHT, width: '100%' }}>
        {data?.completion ? (
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: MESSAGE_LINE_HEIGHT, textAlign: 'center' }}
          >
            {t('done.summary.completion.sets', {
              completed: data.completion.completedSets,
              planned: data.completion.plannedSets,
            })}
          </Text>
        ) : !committed && !failed ? (
          <FinalizationMessage active={!committed && !failed} />
        ) : null}
      </View>
      {/* Same reservation principle for the EARLY/cardio-skipped badges:
          `data.finalizedEarly`/`cardioSkipped` only become true once the
          server's response is adopted into the local execution — i.e.
          exactly at `committed` — so this row is always rendered, at a
          fixed height, even for the (majority) case where no badge ever
          appears, instead of only materializing once the badge itself is
          known. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: spacing[2],
          marginTop: spacing[3],
          minHeight: BADGE_ROW_LINE_HEIGHT,
          width: '100%',
        }}
      >
        {data?.finalizedEarly ? (
          <MonoLabel size={8.5} color={theme.colors.textMuted} style={{ lineHeight: BADGE_ROW_LINE_HEIGHT }}>
            {t('done.summary.completion.earlyBadge').toUpperCase()}
          </MonoLabel>
        ) : null}
        {data?.cardioSkipped ? (
          <MonoLabel size={8.5} color={theme.colors.textMuted} style={{ lineHeight: BADGE_ROW_LINE_HEIGHT }}>
            {t('done.summary.completion.cardioSkippedBadge').toUpperCase()}
          </MonoLabel>
        ) : null}
      </View>
    </View>
  );
}

function SummarySkeleton() {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  return (
    <View accessibilityLabel={t('done.summary.loadingMetrics')} style={{ marginTop: spacing[6], gap: spacing[3] }}>
      <View style={{ height: 148, borderRadius: 74, width: 148, alignSelf: 'center', backgroundColor: theme.colors.surfaceQuiet }} />
      <View style={{ flexDirection: 'row', gap: spacing[3] }}>
        <View style={{ flex: 1, height: 112, borderRadius: 14, backgroundColor: theme.colors.surfaceQuiet }} />
        <View style={{ flex: 1, height: 112, borderRadius: 14, backgroundColor: theme.colors.surfaceQuiet }} />
      </View>
      <View style={{ height: 112, borderRadius: 14, backgroundColor: theme.colors.surfaceQuiet }} />
    </View>
  );
}

function LoadProgressErrorCard({ onRetry }: { onRetry: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  return (
    <View
      accessibilityRole="alert"
      style={{ marginTop: spacing[5], marginBottom: spacing[5], padding: spacing[4], gap: spacing[3], borderRadius: 14, backgroundColor: theme.colors.surfaceQuiet }}
    >
      <Text style={{ color: theme.colors.textSecondaryStrong, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
        {t('done.summary.recordsUnavailable')}
      </Text>
      <CtaButton onPress={onRetry}>{t('done.summary.retryRecords')}</CtaButton>
    </View>
  );
}

function SummaryMetricsGrid({
  data,
  loadProgressStatus,
}: {
  data: WorkoutSummaryData;
  loadProgressStatus: WorkoutSummaryLoadProgressStatus;
}) {
  const { t } = useTranslation('workout');
  const { resolvedUnits } = useUnits();

  const directItems: { label: string; value: string; unit?: string; icon: IconName }[] = [
    {
      label: t('done.summary.metrics.volume'),
      value: formatWorkoutVolumeFromKg(data.volumeKg, resolvedUnits),
      unit: workoutVolumeUnit(data.volumeKg, resolvedUnits),
      icon: 'dumbbell',
    },
    { label: t('done.summary.metrics.sets'), value: String(data.completedSetCount), icon: 'list' },
    { label: t('done.summary.metrics.reps'), value: String(data.totalReps), icon: 'target' },
  ];

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] }}>
      {loadProgressStatus === 'ready' ? (
        <AssessmentMetricCard
          label={t('done.summary.metrics.records')}
          value={String(data.personalRecordCount)}
          icon="trophy"
          size="lg"
          style={{ flexBasis: '47%', flexGrow: 1 }}
        />
      ) : loadProgressStatus === 'error' ? (
        <AssessmentMetricCard
          label={t('done.summary.metrics.records')}
          value="—"
          icon="trophy"
          size="lg"
          style={{ flexBasis: '47%', flexGrow: 1 }}
        />
      ) : (
        <AssessmentMetricCard
          label={t('done.summary.metrics.records')}
          value=""
          icon="trophy"
          size="lg"
          loading
          style={{ flexBasis: '47%', flexGrow: 1 }}
        />
      )}
      {directItems.map((item) => (
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
  sex,
  data,
  workoutName,
  completionConfirmed,
  completionFailed,
  retrying,
  failureCategory,
  onResumeCardioCompletion,
  loadProgressStatus,
  onRetry,
  onRetryLoadProgress,
  onClose,
  onShare,
}: {
  sex: Sex;
  data: WorkoutSummaryData | null;
  workoutName: string;
  // Kept for the caller's observability/recovery contract — this screen's
  // own visual ring no longer reads server checkpoints directly (see
  // `finalizationVisualProgress.ts`/`FinalizationProgressRing.tsx`).
  finalizationStage: WorkoutFinalizationProgressStage;
  completionConfirmed: boolean;
  completionFailed: boolean;
  /** True only while a NEW attempt (after a prior failure) is still in flight. */
  retrying: boolean;
  /** User-facing bucket for the failure text; `null` while `!completionFailed`. Never a raw Firebase code. */
  failureCategory: WorkoutFinalizationErrorCategory | null;
  /**
   * Sends the user back into the existing cardio-finisher screen instead of
   * a plain retry — the only action that can actually resolve
   * `CARDIO_COMPLETION_REQUIRED`. `undefined` when the caller has no cardio
   * finisher to send the user back to; the CTA falls back to the generic
   * retry in that case rather than rendering a dead end.
   */
  onResumeCardioCompletion?: () => void;
  loadProgressStatus: WorkoutSummaryLoadProgressStatus;
  onRetry: () => void;
  onRetryLoadProgress: () => void;
  onClose: () => void;
  onShare: () => void;
}) {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation('workout');
  const insets = useSafeAreaInsets();
  // A COMMITTED sidecar checkpoint can beat the callable response by a few
  // milliseconds. It may fill the ring, but only the authoritative response
  // (or durable execution+event reconciliation) unlocks close/share.
  const committed = completionConfirmed;
  const contentReady = committed && data !== null;
  // Everything derivable from the local execution already in memory — no
  // Firestore read of its own (`useWorkoutSummaryData`) — so this is true
  // essentially as soon as the screen mounts, well before `committed`.
  const hasLocalData = data !== null;

  // Android hardware back used to be wired through `<Modal>`'s own
  // `onRequestClose` — now that this renders in-tree instead (see the
  // `RiseIn` root below), it needs its own listener to keep the exact same
  // gating: swallowed entirely before `contentReady`, otherwise `onClose`.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (contentReady) onClose();
      return true;
    });
    return () => subscription.remove();
  }, [contentReady, onClose]);

  return (
    // Deliberately not a native `<Modal>` — swapping WorkoutScreen's live
    // exercise tree for a brand-new native modal window (plus, on EARLY
    // finish, simultaneously dismissing the exit-confirmation modal) left a
    // frame where neither screen had actually painted yet, showing the
    // native window's default black background through the gap. Rendering
    // in-tree instead removes that boundary entirely: this is the exact
    // same swap-children + fade/rise-in principle the onboarding funnel
    // already uses for its step transitions (`AnimatedStepContainer`), down
    // to reusing its own `RiseIn` building block.
    //
    // Plain `<View>` + `useSafeAreaInsets()`, deliberately not `<SafeAreaView>`
    // (even though a nested `<SafeAreaProvider>` was already removed here).
    // `<SafeAreaView>` from `react-native-safe-area-context` is backed by its
    // own native host component (`NativeSafeAreaView`) that performs its own
    // native-side measurement on every mount — independent of whether the
    // JS `SafeAreaProvider` context is already warm. A brand-new instance of
    // it (this screen, freshly entered) can paint its first frame with
    // stale/zero insets regardless, with the real ones landing a beat later
    // and shoving the header down. `useSafeAreaInsets()` is a plain JS hook
    // that reads the already-resolved context value (from the app's single
    // root `SafeAreaProvider` in `App.tsx`) synchronously on the very first
    // render — applying it as explicit padding below has the correct geometry
    // from frame 1, no native round-trip involved.
    <RiseIn duration={320} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('done.summary.closeAccessibility')}
              accessibilityState={{ disabled: !contentReady }}
              disabled={!contentReady}
              onPress={onClose}
              hitSlop={6}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="x" size={18} color={contentReady ? theme.colors.textPrimary : theme.colors.textFaint} />
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
            <Display size={28} numberOfLines={2}>{data?.workoutName ?? workoutName}</Display>
            {data ? (
              <MonoLabel size={11} style={{ marginTop: spacing[1] }}>
                {localDateLabel(data.performedLocalDate, i18n.language)} · {formatWorkoutShareDuration(data.durationSeconds)}
              </MonoLabel>
            ) : (
              <View style={{ width: 172, height: 12, borderRadius: 6, marginTop: spacing[2], backgroundColor: theme.colors.surfaceQuiet }} />
            )}

            <CompletionHero
              data={data}
              committed={committed}
              failed={completionFailed}
              retrying={retrying}
            />

            {completionFailed && !committed ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing[6], gap: spacing[3] }}>
                <Display size={22} style={{ textAlign: 'center' }}>
                  {t(finishFailedMessageKey(failureCategory)).toUpperCase()}
                </Display>
                {/* A plain retry would resend the same payload the server
                    just rejected for this exact reason and fail again —
                    the only useful action here is finishing the cardio. */}
                {failureCategory === 'CARDIO_COMPLETION_REQUIRED' && onResumeCardioCompletion ? (
                  <CtaButton onPress={onResumeCardioCompletion}>{t('done.completeCardioCta')}</CtaButton>
                ) : (
                  <CtaButton onPress={onRetry}>{t('done.retry')}</CtaButton>
                )}
              </View>
            ) : !hasLocalData ? (
              <SummarySkeleton />
            ) : (
              <>
                {/* Volume/sets/reps and the body map below render immediately
                    off `data` — derived purely from the local execution, no
                    backend wait. PRs/currentBests stay behind
                    `loadProgressStatus` (the freshness barrier for the
                    post-finalization refresh) — `PersonalRecordsSection`
                    itself stays mounted the whole time and only swaps its
                    row values for a same-shaped skeleton while waiting, so
                    there's never a layout hole; a failed refresh still needs
                    a visible retry, which is this card right here. The
                    "Pulso" comparison vs. the previous equivalent session
                    needs no refresh at all — it was already resident in
                    `LoadProgressContext` from the live workout, so it
                    renders immediately too. */}
                {loadProgressStatus === 'error' ? (
                  <LoadProgressErrorCard onRetry={onRetryLoadProgress} />
                ) : null}

                <SummaryMetricsGrid data={data} loadProgressStatus={loadProgressStatus} />

                <WorkoutPulseSection pulse={data.pulse} />

                <PersonalRecordsSection
                  personalRecords={data.personalRecords}
                  currentBests={data.currentBests}
                  performedAnyLoadBasedExercise={data.hasLoadBasedData}
                  loadProgressStatus={loadProgressStatus}
                />

                <MusclesWorkedSection sex={sex} bodyMap={data.bodyMap} />

                {loadProgressStatus === 'ready' ? (
                  <WorkoutHighlightsSection highlights={data.highlights} />
                ) : null}
              </>
            )}
          </ScrollView>

          {contentReady ? <View
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
          </View> : null}
      </View>
    </RiseIn>
  );
}
