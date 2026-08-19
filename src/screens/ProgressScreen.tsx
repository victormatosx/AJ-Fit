import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ScreenBg } from '../components/ui/ScreenBg';
import { ProgressPhotosScreen } from './ProgressPhotosScreen';
import { BodyEvolutionView } from '../components/fitness/BodyEvolutionView';
import { LoadsEvolutionView } from '../components/fitness/LoadsEvolutionView';
import { Display, MonoLabel, Slash } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { motion, sizes, spacing } from '../theme/tokens';
import { useTheme } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useAssessments } from '../hooks/useAssessments';
import {
  PROGRESS_BODY_PREVIEW,
  PROGRESS_BODY_PREVIEW_DELTA,
  PROGRESS_LOADS_PREVIEW,
  SHOW_PROGRESS_DESIGN_PREVIEW,
} from '../data/progressDesignMocks';

/**
 * The Evolution screen.
 *
 * Orchestration only: it owns the sub-view selection and the assessment data,
 * and delegates rendering. Two structural details are load-bearing and must
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
}: {
  /** Opens the full assessment area. Optional so the screen stands alone. */
  onOpenAssessment?: () => void;
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
    refresh,
  } = useAssessments(user?.uid ?? null);

  const tabs: Array<[ProgressView, string]> = [
    ['body', t('progress.tabs.body')],
    ['loads', t('progress.tabs.loads')],
    ['photos', t('progress.tabs.photos')],
  ];

  const handleRetry = useCallback(() => {
    void refresh();
  }, [refresh]);

  const bodyAssessments = SHOW_PROGRESS_DESIGN_PREVIEW ? PROGRESS_BODY_PREVIEW : assessments;
  const bodyLatest = SHOW_PROGRESS_DESIGN_PREVIEW ? PROGRESS_BODY_PREVIEW[0]! : latest;
  const bodyEvolution = SHOW_PROGRESS_DESIGN_PREVIEW
    ? PROGRESS_BODY_PREVIEW_DELTA
    : evolutionSincePrevious;

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
          marginBottom: spacing[5],
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
            contentContainerStyle={{ paddingBottom: spacing[8] }}
            showsVerticalScrollIndicator={false}
          >
            {pageHeader}
            <PanelFade viewKey={view}>
              {view === 'body' ? (
                <BodyEvolutionView
                  assessments={bodyAssessments}
                  loading={SHOW_PROGRESS_DESIGN_PREVIEW ? false : loading}
                  error={SHOW_PROGRESS_DESIGN_PREVIEW ? null : error}
                  latest={bodyLatest}
                  evolutionSincePrevious={bodyEvolution}
                  onRetry={handleRetry}
                  onOpenAssessment={onOpenAssessment}
                />
              ) : SHOW_PROGRESS_DESIGN_PREVIEW ? (
                <LoadsEvolutionView exercises={PROGRESS_LOADS_PREVIEW} />
              ) : (
                <LoadsEmptyState />
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
function PanelFade({ viewKey, children }: { viewKey: string; children: React.ReactNode }) {
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

/**
 * Loads panel.
 *
 * Weights entered during a workout live in that session's React state and are
 * not persisted, so there is no history, no personal record and no volume to
 * chart. Rather than show invented numbers, this states plainly what the app
 * does today. It becomes a real panel the moment workout logging is persisted.
 */
function LoadsEmptyState() {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing[6] }}>
      <Slash style={{ marginBottom: spacing[5] }}>
        {t('progress.loads.eyebrow').toUpperCase()}
      </Slash>
      <View style={{ alignItems: 'center', paddingVertical: spacing[10], gap: spacing[3] }}>
        <Icon name="dumbbell" size={26} color={theme.colors.textFaint} />
        <Display size={20} style={{ textAlign: 'center' }}>
          {t('progress.loads.empty.title')}
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
          {t('progress.loads.empty.description')}
        </Text>
        <MonoLabel size={9} style={{ marginTop: spacing[2], textAlign: 'center' }}>
          {t('progress.loads.empty.hint').toUpperCase()}
        </MonoLabel>
      </View>
    </View>
  );
}
