import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
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
import { Display, Slash } from '../components/ui/Display';
import { motion, radii, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAssessments } from '../hooks/useAssessments';
import { useHealthWeightSamples } from '../hooks/useHealthWeightSamples';
import { useLoadProgressState } from '../loadProgress/LoadProgressContext';
import { useScreenFocusEffect } from '../state/ScreenActivity';

/**
 * The Evolution screen.
 *
 * Orchestration only: it owns the sub-view selection plus the assessment and
 * workout-load data hooks, and delegates rendering. Two structural details are load-bearing and must
 * survive any future visual change:
 *
 *  1. The Photos panel is mounted INSTEAD of the scroll view, never alongside
 *     it. `ProgressPhotosScreen` locks the vault when it unmounts, so keeping
 *     all panels mounted would silently leave the vault open after the user
 *     navigated away.
 *  2. `panelHeader` (the shared blue pill selector) is handed to that panel
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
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const { user, questionnaire } = useAuth();
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

  const selectedExercise = selectedExerciseId
    ? loadExercises.find((exercise) => exercise.exerciseId === selectedExerciseId) ?? null
    : null;

  const tabs: [ProgressView, string][] = [
    ['body', t('progress.tabs.body')],
    ['loads', t('progress.tabs.loads')],
    ['photos', t('progress.tabs.photos')],
  ];

  // Mirrors the exact "locked preview" condition each panel uses internally
  // (never loading, never erroring, no real data yet) so the ScrollView
  // around it can stop scrolling and give the panel the full screen height
  // to center its unlock message in — without duplicating that condition
  // inside each panel's own render. Imported health weight counts as real
  // data too: when it exists but no assessment has been done yet, the body
  // panel renders its weight section for real and only locks the
  // composition sub-section inline, so it no longer takes the full-screen
  // layout here.
  const isBodyLocked = !(loading && importedWeightsLoading) && !(error && importedWeightsError)
    && !latest && importedWeights.length === 0;
  const isLoadsLocked = !loadsLoading && !loadsError && loadExercises.length === 0;
  const isCurrentViewLocked = view === 'body' ? isBodyLocked : view === 'loads' ? isLoadsLocked : false;

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

  const title = (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3], paddingBottom: spacing[5] }}>
      <Slash style={{ marginBottom: spacing[2.5] }}>
        {t('progress.header.eyebrow').toUpperCase()}
      </Slash>
      <Display size={40}>{t('progress.header.title').toUpperCase()}</Display>
    </View>
  );

  /** Shared header for all three Evolution tabs: eyebrow/title plus the blue pill selector. */
  const panelHeader = (
    <View>
      {title}
      <PillTabs
        tabs={tabs}
        view={view}
        previousView={previousViewRef.current}
        onSelect={(next) => { setView(next); setSelectedExerciseId(null); }}
        // Zero when the active panel is a locked preview: that gap would
        // otherwise leave a clean, un-blurred strip between the selector
        // and the blurred content. The blur must start right below it.
        style={{ marginBottom: isCurrentViewLocked ? 0 : spacing[5] }}
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
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={
              isCurrentViewLocked ? { flexGrow: 1 } : { paddingBottom: spacing[8] }
            }
            scrollEnabled={!isCurrentViewLocked}
            showsVerticalScrollIndicator={false}
          >
            {panelHeader}
            <PanelFade viewKey={view} fillHeight={isCurrentViewLocked}>
              {view === 'body' ? (
                // Corpo shows the user's own assessments when there are any.
                // With none yet, BodyEvolutionView shows a blurred preview of
                // this same panel fed by local demo data (never persisted,
                // never real) with a CTA to the assessment flow — see
                // EvolutionLockedPreview.
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
  fillHeight,
  children,
}: {
  viewKey: string;
  /** True while the panel is the full-screen locked preview — stretches this to the ScrollView's flexGrow:1 content so the preview's own centering has the whole visible height to work with. */
  fillHeight: boolean;
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
      style={[
        fillHeight ? { flex: 1 } : null,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
