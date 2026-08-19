import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Animated, StyleSheet, useWindowDimensions, type ViewToken } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VideoView } from 'expo-video';
import { CarouselIndicators } from './CarouselIndicators';
import { motion, sizes, spacing } from '../../theme/tokens';
import { useTheme, type AppTheme } from '../../theme';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { getGuidedWorkoutVideoPlayers } from '../../onboarding/onboardingVideoPreload';
import { guidedWorkoutShowcaseSlides, type GuidedWorkoutSlide } from '../../data/guidedWorkoutShowcase';

const GAP = spacing[4];
// Item narrower than the available row so the next/previous phone peeks in
// at the edge — same "you can swipe" affordance as EvolutionCarousel.
const ITEM_WIDTH_RATIO = 0.72;
// Caps the mockup's height so the carousel never pushes the caption/CTA
// below the fold.
const MAX_PHONE_HEIGHT_RATIO = 0.42;
// Matches the source clips' native 384x848 frame, so `contentFit="cover"`
// never has to crop.
const VIDEO_ASPECT_RATIO = 384 / 848;
const PHONE_BEZEL = 6;
const PHONE_SCREEN_RADIUS = 22;
const PHONE_FRAME_RADIUS = PHONE_SCREEN_RADIUS + PHONE_BEZEL;
const AUTO_ADVANCE_INTERVAL_MS = 6000;

export function GuidedWorkoutCarousel() {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();
  const players = getGuidedWorkoutVideoPlayers();

  const rowWidth = Math.min(windowWidth - sizes.screenGutter * 2, sizes.contentMaxWidth);
  const itemWidth = Math.round(rowWidth * ITEM_WIDTH_RATIO);
  // Half the leftover row width, applied as leading/trailing padding on the
  // FlatList's content — keeps every slide's phone centered both at rest
  // and while it peeks in from the side (see EvolutionCarousel for the
  // detailed rationale).
  const sidePad = Math.round((rowWidth - itemWidth) / 2);
  // Single source of truth for the horizontal scroll grid: any programmatic
  // scroll (auto-advance) targets multiples of this same value.
  const snapInterval = itemWidth + GAP;

  const screenHeight = Math.min(itemWidth / VIDEO_ASPECT_RATIO, windowHeight * MAX_PHONE_HEIGHT_RATIO);
  const screenWidth = screenHeight * VIDEO_ASPECT_RATIO;

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<GuidedWorkoutSlide>>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reduceMotion) return;
    textOpacity.setValue(0);
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: motion.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, reduceMotion, textOpacity]);

  // Only the active slide's video plays; the others stay paused so at most
  // one decoder is actively driving frames at a time.
  useEffect(() => {
    const active = guidedWorkoutShowcaseSlides[activeIndex];
    for (const slide of guidedWorkoutShowcaseSlides) {
      const player = players[slide.id];
      if (!player) continue;
      if (!reduceMotion && slide.id === active?.id) {
        player.play();
      } else {
        player.pause();
      }
    }
  }, [activeIndex, players, reduceMotion]);

  useEffect(() => {
    return () => {
      for (const slide of guidedWorkoutShowcaseSlides) {
        players[slide.id]?.pause();
      }
    };
  }, [players]);

  const stopAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current) {
      clearInterval(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  // Auto-advances one slide every 6s; paused while the user is actively
  // dragging (see onScrollBeginDrag below) and skipped entirely under
  // reduce-motion.
  const startAutoAdvance = useCallback(() => {
    stopAutoAdvance();
    if (reduceMotion) return;
    autoAdvanceTimer.current = setInterval(() => {
      const next = (activeIndexRef.current + 1) % guidedWorkoutShowcaseSlides.length;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
    }, AUTO_ADVANCE_INTERVAL_MS);
  }, [reduceMotion, stopAutoAdvance, snapInterval]);

  useEffect(() => {
    startAutoAdvance();
    return stopAutoAdvance;
  }, [startAutoAdvance, stopAutoAdvance]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setActiveIndex(first.index);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const renderItem = useCallback(
    ({ item }: { item: GuidedWorkoutSlide }) => (
      <View style={{ width: itemWidth, alignItems: 'center' }}>
        <View
          style={[
            styles.phoneFrame,
            {
              width: screenWidth + PHONE_BEZEL * 2,
              height: screenHeight + PHONE_BEZEL * 2,
              borderRadius: PHONE_FRAME_RADIUS,
            },
          ]}
        >
          <View
            style={[
              styles.phoneScreen,
              { width: screenWidth, height: screenHeight, borderRadius: PHONE_SCREEN_RADIUS },
            ]}
          >
            <VideoView
              style={StyleSheet.absoluteFill}
              player={players[item.id]}
              contentFit="cover"
              nativeControls={false}
              allowsPictureInPicture={false}
              pointerEvents="none"
            />
          </View>
        </View>
      </View>
    ),
    [itemWidth, screenWidth, screenHeight, players, styles],
  );

  const active = guidedWorkoutShowcaseSlides[activeIndex] ?? guidedWorkoutShowcaseSlides[0];

  return (
    <View style={{ width: rowWidth, alignSelf: 'center' }}>
      <FlatList
        ref={listRef}
        data={guidedWorkoutShowcaseSlides}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScrollBeginDrag={stopAutoAdvance}
        onMomentumScrollEnd={startAutoAdvance}
        removeClippedSubviews
        accessibilityLabel={t('interstitials.guidedWorkout.carouselLabel')}
      />

      <CarouselIndicators count={guidedWorkoutShowcaseSlides.length} activeIndex={activeIndex} />

      <Animated.View
        style={{
          opacity: reduceMotion ? 1 : textOpacity,
          marginTop: spacing[4],
          alignItems: 'center',
          paddingHorizontal: spacing[2],
        }}
      >
        <Text
          style={{
            fontFamily: theme.fonts.uiBold,
            fontSize: 16,
            lineHeight: 22,
            color: theme.colors.textPrimary,
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          {t(`interstitials.guidedWorkout.slides.${active.id}.body`)}
        </Text>
      </Animated.View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
  phoneFrame: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.floatingShadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  phoneScreen: {
    overflow: 'hidden',
    backgroundColor: theme.colors.background,
  },
  });
}
