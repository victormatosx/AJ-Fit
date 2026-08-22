import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Animated, useWindowDimensions, type ViewToken } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PhoneFrame } from '../ui/PhoneFrame';
import { CarouselIndicators } from './CarouselIndicators';
import { motion, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { evolutionShowcaseSlides, type EvolutionSlide } from '../../data/evolutionShowcase';

const GAP = spacing[4];
// Item narrower than the available row so the next/previous phone peeks in
// at the edge — the "you can swipe" affordance the spec asks for.
const ITEM_WIDTH_RATIO = 0.8;
const PHONE_WIDTH_RATIO = 0.97;
// Caps the mockup's height on short devices so the carousel never pushes
// the CTA below the fold; width is then derived from this via the frame's
// fixed aspect ratio.
const MAX_PHONE_HEIGHT_RATIO = 0.4;
const PHONE_ASPECT_RATIO = 9 / 19.5;
// Only the top 80% of the screenshot is shown — crops the home-indicator/
// bottom chrome and lets the frame sit larger without needing more vertical
// room than MAX_PHONE_HEIGHT_RATIO budgets for.
const PHONE_CROP_RATIO = 0.8;
const AUTO_ADVANCE_INTERVAL_MS = 4000;

export function EvolutionCarousel() {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();

  const rowWidth = Math.min(windowWidth - sizes.screenGutter * 2, sizes.contentMaxWidth);
  const itemWidth = Math.round(rowWidth * ITEM_WIDTH_RATIO);
  // Half the leftover row width, applied as leading/trailing padding on the
  // FlatList's content — without this the row (which is narrower than its
  // container) sits flush left, so the first slides read as shifted left
  // and the last one, where the scrollable content runs out, reads as
  // shifted right. This keeps every slide's phone centered on screen both
  // at rest and while it peeks in from the side.
  const sidePad = Math.round((rowWidth - itemWidth) / 2);
  // Single source of truth for the horizontal scroll grid: this is the
  // exact distance the native `snapToInterval` grid steps by. Any
  // programmatic scroll (auto-advance) MUST target multiples of this same
  // value — going through `scrollToIndex`'s built-in offset estimate
  // instead diverges from this grid (it estimates from measured cell
  // length, which doesn't reliably include the `ItemSeparatorComponent`
  // gap), producing an index-proportional drift.
  const snapInterval = itemWidth + GAP;
  const phoneWidthFromRow = Math.round(itemWidth * PHONE_WIDTH_RATIO);
  // The frame only shows PHONE_CROP_RATIO of its full height, so for a
  // given height budget it can afford to be proportionally wider.
  const phoneWidthFromHeight = Math.round(
    (windowHeight * MAX_PHONE_HEIGHT_RATIO * PHONE_ASPECT_RATIO) / PHONE_CROP_RATIO,
  );
  const phoneWidth = Math.min(phoneWidthFromRow, phoneWidthFromHeight);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<EvolutionSlide>>(null);
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

  const stopAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current) {
      clearInterval(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  // Auto-advances one slide per second; the carousel is educational, not a
  // gate, so this keeps it moving for users who never touch it. Paused
  // while the user is actively dragging (see onScrollBeginDrag below) and
  // skipped entirely under reduce-motion.
  const startAutoAdvance = useCallback(() => {
    stopAutoAdvance();
    if (reduceMotion) return;
    autoAdvanceTimer.current = setInterval(() => {
      const next = (activeIndexRef.current + 1) % evolutionShowcaseSlides.length;
      // `scrollToOffset` sets the scroll position directly — the same
      // coordinate space `snapToInterval` snaps to — instead of going
      // through `scrollToIndex`'s cell-measurement estimate.
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
    ({ item }: { item: EvolutionSlide }) => (
      <View style={{ width: itemWidth, alignItems: 'center' }}>
        <PhoneFrame
          width={phoneWidth}
          cropRatio={PHONE_CROP_RATIO}
          image={item.image}
          placeholderIcon={item.icon}
          placeholderLabel={t('interstitials.evolution.screenshotPlaceholder', {
            index: evolutionShowcaseSlides.findIndex((s) => s.id === item.id) + 1,
          })}
          accessibilityLabel={t(`interstitials.evolution.slides.${item.id}.title`)}
        />
      </View>
    ),
    [itemWidth, phoneWidth, t],
  );

  const active = evolutionShowcaseSlides[activeIndex] ?? evolutionShowcaseSlides[0];

  return (
    <View style={{ width: rowWidth, alignSelf: 'center' }}>
      <FlatList
        ref={listRef}
        data={evolutionShowcaseSlides}
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
        accessibilityLabel={t('interstitials.evolution.carouselLabel')}
      />

      <CarouselIndicators count={evolutionShowcaseSlides.length} activeIndex={activeIndex} />

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
            fontSize: 18,
            color: theme.colors.textPrimary,
            textAlign: 'center',
          }}
        >
          {t(`interstitials.evolution.slides.${active.id}.title`)}
        </Text>
        <Text
          style={{
            marginTop: spacing[1.5],
            fontFamily: theme.fonts.ui,
            fontSize: 14,
            lineHeight: 20,
            color: theme.colors.textMuted,
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          {t(`interstitials.evolution.slides.${active.id}.body`)}
        </Text>
      </Animated.View>
    </View>
  );
}
