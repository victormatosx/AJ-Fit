import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { BodyEvolutionView } from '../components/fitness/BodyEvolutionView';
import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';
import { Display, Slash } from '../components/ui/Display';
import { motion, sizes, spacing } from '../theme/tokens';
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
 *  2. `pageHeader` is handed to that panel and rendered inside its FlatList
 *     header, not stacked above it. Lifting it out would create a second
 *     scroll surface and defeat the grid's virtualization.
 */

type ProgressView = 'body' | 'loads' | 'photos';

const GUTTER = sizes.screenGutter;

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
  const { user } = useAuth();
  const [view, setView] = useState<ProgressView>('body');

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

  /**
   * Header lives here because the Photos panel renders it inside its list.
   * It is intentionally cheap: no data fetching, no animation of its own.
   */
  const pageHeader = (
    <View>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[3], paddingBottom: spacing[5] }}>
        <Slash style={{ marginBottom: spacing[2.5] }}>
          {t('progress.header.eyebrow').toUpperCase()}
        </Slash>
        <Display size={40}>{t('progress.header.title').toUpperCase()}</Display>
      </View>

      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: GUTTER,
          // Zero when the active panel is a locked preview: that gap used to
          // leave a clean, un-blurred strip between the tab row and the
          // blurred content starting below it. The blur must start exactly
          // at this row's bottom edge instead.
          marginBottom: isCurrentViewLocked ? 0 : spacing[5],
          borderBottomWidth: sizes.hairline,
          borderBottomColor: theme.colors.border,
        }}
      >
        {tabs.map(([key, label]) => {
          const selected = view === key;
          return (
            <Pressable
              key={key}
              onPress={() => setView(key)}
              accessibilityRole="tab"
              accessibilityLabel={t('progress.accessibility.selectTab', { tab: label })}
              accessibilityState={{ selected }}
              style={{
                paddingVertical: spacing[3],
                marginRight: spacing[6],
                borderBottomWidth: 2,
                // The rule below the row is the baseline; the selected tab
                // simply paints over it, so nothing shifts on selection.
                borderBottomColor: selected ? theme.colors.primary : 'transparent',
                marginBottom: -sizes.hairline,
              }}
            >
              <Text
                style={{
                  fontFamily: theme.fonts.mono,
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  color: selected ? theme.colors.textPrimary : theme.colors.textFaint,
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

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {view === 'photos' ? (
          <ProgressPhotosScreen pageHeader={pageHeader} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={
              isCurrentViewLocked ? { flexGrow: 1 } : { paddingBottom: spacing[8] }
            }
            scrollEnabled={!isCurrentViewLocked}
            showsVerticalScrollIndicator={false}
          >
            {pageHeader}
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
