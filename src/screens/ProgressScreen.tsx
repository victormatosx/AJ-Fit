import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { BodyEvolutionView } from '../components/fitness/BodyEvolutionView';
import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';
import { ExerciseEvolutionDetail } from '../components/fitness/ExerciseEvolutionDetail';
import { EvolutionProgressTicker } from '../components/fitness/EvolutionProgressTicker';
import { buildEvolutionProgressTickerItems } from '../components/fitness/evolutionProgressTickerItems';
import { Display, MonoLabel } from '../components/ui/Display';
import { ProfileAvatar } from '../components/ui/ProfileAvatar';
import { motion, radii, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAssessments } from '../hooks/useAssessments';
import { useHealthWeightSamples } from '../hooks/useHealthWeightSamples';
import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import { usePhotoVault } from '../state/PhotoVaultContext';
import { useIsScreenActive, useScreenFocusEffect } from '../state/ScreenActivity';
import { useUnits } from '../state/UnitsContext';

/**
 * The Evolution screen.
 *
 * Orchestration only: it owns the sub-view selection plus the assessment and
 * workout-load data hooks, and delegates rendering. Two structural details are load-bearing and must
 * survive any future visual change:
 *
 *  1. The Photo Vault session belongs to THIS screen, for exactly as long as
 *     it is the active one — see the two effects below. It is deliberately
 *     not scoped to the Fotos panel's mount: the vault has to be open before
 *     the user taps Fotos, or that tab lands on the opening transition and
 *     reloads its gallery from scratch on every visit.
 *  2. The Photos panel is still mounted INSTEAD of the scroll view, never
 *     alongside it — one scroll surface at a time, and the Photos grid gets
 *     to own its own virtualization.
 *  3. `panelHeader` (the shared blue pill selector) is handed to that panel
 *     and rendered inside its FlatList header, not stacked above it.
 *     Lifting it out would create a second scroll surface and defeat the
 *     grid's virtualization.
 */

type ProgressView = 'body' | 'loads' | 'photos';

const GUTTER = sizes.screenGutter;
/** Inset of the pill selector's indicator from its track, on all four sides. */
const PILL_PADDING = 4;

export function ProgressScreen({
  onOpenAssessment,
  onStartWorkout,
}: {
  /** Opens the full assessment area. Optional so the screen stands alone. */
  onOpenAssessment?: () => void;
  /** Starts a workout. Optional so the screen stands alone. */
  onStartWorkout?: () => void;
} = {}) {
  const { t, i18n } = useTranslation('home');
  const { theme } = useTheme();
  const { user, questionnaire, profile } = useAuth();
  const { resolvedUnits } = useUnits();
  // Same authoritative source AppShell reads for every other body map. Left
  // nullable on purpose: the panels drop the map rather than flash the male
  // anatomy while the questionnaire resolves.
  const sex = questionnaire?.answers.sex ?? null;
  const [view, setView] = useState<ProgressView>('body');
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  // Fotos mounts `PillTabs` fresh every time it's entered/left (see the
  // "mounted INSTEAD of" doc comment above) — a brand-new Animated.Value
  // always starts at slot 0, which made returning from Fotos visibly slide
  // the indicator through Corpo first. Remembering the tab active just
  // before this one lets a fresh mount start positioned there instead.
  const previousViewRef = useRef<ProgressView>(view);
  useEffect(() => {
    previousViewRef.current = view;
  }, [view]);

  const {
    assessments,
    loading,
    error,
    latest,
    evolutionSincePrevious,
    refresh: refreshAssessments,
  } = useAssessments(user?.uid ?? null);
  const {
    samples: importedWeights,
    loading: importedWeightsLoading,
    error: importedWeightsError,
    refresh: refreshImportedWeights,
  } = useHealthWeightSamples(user?.uid ?? null);
  const {
    exercises: loadExercises,
    recordsLast90Days,
    todayLocalDate,
    loading: loadsLoading,
    error: loadsError,
    refresh: refreshLoads,
  } = useLoadProgressState();

  // i18next's generated `t` type only accepts its own literal key union —
  // the builder takes a plain string key (same `as unknown as` cast
  // `EvolutionTicker`/`LoadsEvolutionView` already use for this exact
  // mismatch).
  const tLoose = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const evolutionTickerItems = useMemo(
    () => buildEvolutionProgressTickerItems({
      weightDeltaKg: evolutionSincePrevious?.weightDelta ?? null,
      lastAssessmentMeasuredAt: latest ? latest.measuredAt.toDate() : null,
      recordsLast90DaysCount: loadExercises.length > 0 ? recordsLast90Days.length : null,
      assessmentsCount: assessments.length > 0 ? assessments.length : null,
      // An account with nothing logged still gets the band, with the real
      // zeros — but only once both reads have actually answered, so a slow
      // or failed load never flashes "0 avaliações" at someone who has them.
      dataSettled: !loading && !loadsLoading && !error && !loadsError,
      resolvedUnits,
      t: tLoose,
    }),
    [
      evolutionSincePrevious, latest, loadExercises.length, recordsLast90Days, assessments.length,
      loading, loadsLoading, error, loadsError, resolvedUnits, tLoose,
    ],
  );

  const selectedExercise = selectedExerciseId
    ? loadExercises.find((exercise) => exercise.exerciseId === selectedExerciseId) ?? null
    : null;

  const tabs: [ProgressView, string][] = [
    ['body', t('progress.tabs.body')],
    ['loads', t('progress.tabs.loads')],
    ['photos', t('progress.tabs.photos')],
  ];

  const handleRetry = useCallback(() => {
    void refreshAssessments();
    void refreshImportedWeights();
  }, [refreshAssessments, refreshImportedWeights]);

  const handleLoadsRetry = useCallback(() => {
    void refreshLoads();
  }, [refreshLoads]);

  // Persistent tabs do not remount when revisited. Revalidate on every real
  // activation as a fallback for changes made on another device or while the
  // Progress tab was inactive. Local saves arrive even sooner through the
  // assessment/load refresh buses used by their respective hooks.
  useScreenFocusEffect(() => {
    void refreshAssessments();
    void refreshImportedWeights();
    void refreshLoads();
  });

  /**
   * The Photo Vault session, opened with this screen and closed with it.
   *
   * Scoped to the screen being ACTIVE, never merely mounted: this tab stays
   * mounted while the user is on Home/Treino (see `useScreenFocusEffect`
   * above), and an open vault must not outlive the screen that justifies it.
   * `useScreenFocusEffect`'s cleanup covers both leaving the tab and the
   * screen unmounting outright (logout).
   *
   * Opening it here rather than inside the Fotos panel is what lets that tab
   * land on an already-open gallery: a session started on the tap itself
   * cannot be ready for the first frames, and re-locking on every tab switch
   * would make every return pay for the transition again. A background lock
   * still closes it — `vaultStatus` returning to `'locked'` re-runs the open
   * effect once the app is foregrounded again.
   */
  const {
    status: vaultStatus,
    lastIssue: vaultIssue,
    unlock: unlockVault,
    lock: lockVault,
  } = usePhotoVault();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const isScreenActive = useIsScreenActive();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setAppActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);

  useScreenFocusEffect(() => () => lockVault());

  // Same guards the Fotos panel applies to its own retry path: never open a
  // session behind an app-switcher preview, and never retry a genuine
  // failure in a loop. A cancellation is not one — it only means the app
  // left the foreground mid-open, and coming back re-runs this.
  useEffect(() => {
    if (!isScreenActive || !appActive || vaultStatus !== 'locked') return;
    if (vaultIssue !== null && vaultIssue !== 'vaultAuthCancelled') return;
    void unlockVault();
  }, [isScreenActive, appActive, vaultStatus, vaultIssue, unlockVault]);

  // Same date-line eyebrow + avatar Treino/Dieta/Home already use — only
  // the title text differs ("Evolução." instead of "Treino."/"Dieta.").
  const headerDisplayName = profile?.profile.name || user?.displayName || '';
  const headerDateLabel = t('meta.todayLine', {
    weekday: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    day: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { day: '2-digit', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
    month: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { month: 'short', timeZone: 'UTC' }).format(new Date(`${todayLocalDate}T12:00:00Z`)),
  }).toUpperCase();

  /** Shared by all three Evolution tabs: header, evolution ticker, and the blue pill selector. */
  const panelHeader = (
    <View>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 50 - 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <MonoLabel color={theme.colors.textFaint}>{headerDateLabel}</MonoLabel>
          <Display size={34} style={{ marginTop: 8 }}>{t('progress.header.title')}.</Display>
        </View>
        <ProfileAvatar
          displayName={headerDisplayName}
          photoURL={profile?.profile.photoURL}
          photoVersion={profile?.profile.photoVersion}
          size={46}
        />
      </View>

      <View style={{ marginTop: 4, marginBottom: 18 }}>
        <EvolutionProgressTicker items={evolutionTickerItems} />
      </View>

      <PillTabs
        tabs={tabs}
        view={view}
        previousView={previousViewRef.current}
        onSelect={(next) => { setView(next); setSelectedExerciseId(null); }}
        style={{ marginBottom: spacing[5] }}
      />
    </View>
  );

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {selectedExercise ? (
          <ExerciseEvolutionDetail
            exercise={selectedExercise}
            todayLocalDate={todayLocalDate}
            onBack={() => setSelectedExerciseId(null)}
          />
        ) : view === 'photos' ? (
          <ProgressPhotosScreen pageHeader={panelHeader} />
        ) : (
          // Every Corpo/Cargas state — populated, empty, loading, error —
          // is a normal top-aligned scrolling panel. The empty states used
          // to be the exception (scrolling off, content centered in the
          // screen height) because they were a single centered message over
          // a cropped preview; they are now taller than the viewport and
          // have to scroll like any other.
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: spacing[8] }}
            showsVerticalScrollIndicator={false}
          >
            {panelHeader}
            <PanelFade viewKey={view}>
              {view === 'body' ? (
                // Corpo shows the user's own assessments when there are any.
                // With none yet — and no imported health weight either —
                // BodyEvolutionView renders its empty state: the same
                // sections with a dash in place of every figure, and a CTA
                // into the assessment flow.
                <BodyEvolutionView
                  assessments={assessments}
                  loading={loading}
                  error={error}
                  latest={latest}
                  evolutionSincePrevious={evolutionSincePrevious}
                  importedWeights={importedWeights}
                  importedWeightsLoading={importedWeightsLoading}
                  importedWeightsError={importedWeightsError}
                  onRetry={handleRetry}
                  onOpenAssessment={onOpenAssessment}
                  sex={sex}
                />
              ) : (
                <LoadsEvolutionView
                  exercises={loadExercises}
                  recordsLast90Days={recordsLast90Days}
                  todayLocalDate={todayLocalDate}
                  loading={loadsLoading}
                  error={loadsError}
                  onRetry={handleLoadsRetry}
                  onStartWorkout={onStartWorkout}
                  onSelectExercise={setSelectedExerciseId}
                  sex={sex}
                />
              )}
            </PanelFade>
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

/**
 * Full-width pill selector with a sliding accent indicator.
 *
 * Shared by all three Evolution tabs (Corpo, Cargas, Fotos) via `panelHeader`
 * above — there is no separate selector implementation for Photos. The
 * indicator is a single absolutely-positioned layer translated between
 * equal-width slots, so the labels themselves never move and nothing
 * reflows on selection.
 */
function PillTabs({
  tabs,
  view,
  previousView,
  onSelect,
  style,
}: {
  tabs: [ProgressView, string][];
  view: ProgressView;
  /** Tab active right before this one — see the mount-position effect below. */
  previousView: ProgressView;
  onSelect: (view: ProgressView) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const [trackWidth, setTrackWidth] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  // Guards the one-time positioning below from repeating on every later tab
  // switch, which must keep animating continuously from wherever `offset`
  // already is, not snap back to `previousView` again.
  const hasPositionedRef = useRef(false);

  const index = tabs.findIndex(([key]) => key === view);
  const initialIndex = tabs.findIndex(([key]) => key === previousView);
  const slotWidth = trackWidth > 0 ? trackWidth / tabs.length : 0;

  useEffect(() => {
    // Nothing to position yet — the indicator itself isn't rendered below
    // until `slotWidth` is known either.
    if (slotWidth === 0) return;
    if (!hasPositionedRef.current) {
      // First time we know the real slot width: this is either the very
      // first mount, or a fresh mount after crossing the Fotos boundary.
      // Start the indicator at the tab the user was actually on, so the
      // animation below always slides from a real previous position —
      // never from a fixed leftmost slot that would read as sliding
      // through an unrelated tab.
      offset.setValue(initialIndex * slotWidth);
      hasPositionedRef.current = true;
    }
    Animated.timing(offset, {
      toValue: index * slotWidth,
      duration: motion.duration.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, offset, slotWidth, initialIndex]);

  return (
    <View style={[{ paddingHorizontal: GUTTER }, style]}>
      <View
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width - PILL_PADDING * 2)}
        style={{
          flexDirection: 'row',
          padding: PILL_PADDING,
          borderRadius: radii.pill,
          borderWidth: sizes.hairline,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceMuted,
        }}
      >
        {slotWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: PILL_PADDING,
              bottom: PILL_PADDING,
              left: PILL_PADDING,
              width: slotWidth,
              borderRadius: radii.pill,
              backgroundColor: theme.colors.primary,
              transform: [{ translateX: offset }],
            }}
          />
        ) : null}

        {tabs.map(([key, label]) => {
          const selected = view === key;
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              accessibilityRole="tab"
              accessibilityLabel={t('progress.accessibility.selectTab', { tab: label })}
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 10.5,
                  letterSpacing: 1.8,
                  textTransform: 'uppercase',
                  color: selected ? theme.colors.primaryForeground : theme.colors.textMuted,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Fade + small rise when the selected panel changes.
 *
 * Deliberately wraps only the panel body, never the Photos grid: animating a
 * virtualized list of decrypted thumbnails would re-run layout on every cell
 * for no benefit. `useNativeDriver` keeps it off the JS thread, and the
 * animation never gates interaction — the panel is already mounted and
 * touchable while it fades in.
 */
function PanelFade({
  viewKey,
  children,
}: {
  viewKey: string;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration.normal,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [viewKey, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
