import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, FlatList, useWindowDimensions, type ViewToken, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PhoneFrame } from '../ui/PhoneFrame';
import { CarouselIndicators } from './CarouselIndicators';
import { motion, sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { useReducedMotionPreference } from '../../lib/reducedMotion';
import { ajFitProgressFeatures, type AjFitProgressFeature, type AjFitProgressFeatureId } from '../../data/ajFitProgressShowcase';

const GAP = spacing[3];
// The item (snap) cell is narrower than the phone itself, so neighboring
// phones overlap into each other's cell and bleed past the screen edges —
// the "laterais parcialmente fora da viewport" look the spec asks for,
// rather than three non-overlapping cards in a row.
const ITEM_WIDTH_RATIO = 0.6;
const PHONE_WIDTH_RATIO = 0.78;
const MAX_PHONE_HEIGHT_RATIO = 0.46;
const PHONE_ASPECT_RATIO = 9 / 19.5;
// Crop away the bottom home-indicator chrome so the frame can afford to be
// wider (and therefore more dominant) within the same vertical budget —
// same rationale as EvolutionCarousel.
const PHONE_CROP_RATIO = 0.88;

const AUTO_ADVANCE_INTERVAL_MS = 3200;
const RESUME_AFTER_INTERACTION_MS = 3200;

const CENTER_SCALE = 1;
const SIDE_SCALE = 0.86;
const CENTER_OPACITY = 1;
const SIDE_OPACITY = 0.55;
const SIDE_ROTATE_DEG = 10;
const SIDE_PULL_PX = 16;
const PERSPECTIVE = 900;

// Repeat the 3-item ring many times so normal use (auto-advance + a
// reasonable number of manual swipes) never gets near either end of the
// underlying list. `recenterIfNeeded` silently snaps back to the middle lap
// if it ever does — invisible since every lap renders the same 3 features.
const RING = ajFitProgressFeatures;
const LAPS = 15;
const VIRTUAL_ITEMS: AjFitProgressFeature[] = Array.from({ length: LAPS }, () => RING).flat();
const MIDDLE_LAP = Math.floor(LAPS / 2);
const START_INDEX = MIDDLE_LAP * RING.length + RING.findIndex((f) => f.id === 'loads');
const EDGE_LAP_BUFFER = 3; // laps of headroom kept on each side before recentering

export function AjFitProgressCarousel() {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotionPreference();

  const rowWidth = windowWidth;
  const itemWidth = Math.round(rowWidth * ITEM_WIDTH_RATIO);
  const sidePad = Math.round((rowWidth - itemWidth) / 2);
  const snapInterval = itemWidth + GAP;

  const phoneWidthFromRow = Math.round(rowWidth * PHONE_WIDTH_RATIO);
  const phoneWidthFromHeight = Math.round(
    (windowHeight * MAX_PHONE_HEIGHT_RATIO * PHONE_ASPECT_RATIO) / PHONE_CROP_RATIO,
  );
  const phoneWidth = Math.min(phoneWidthFromRow, phoneWidthFromHeight);

  const [activeId, setActiveId] = useState<AjFitProgressFeatureId>('loads');
  const scrollX = useRef(new Animated.Value(START_INDEX * snapInterval)).current;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const listRef = useRef<FlatList<AjFitProgressFeature>>(null);
  const virtualIndexRef = useRef(START_INDEX);
  const autoAdvanceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserDraggingRef = useRef(false);

  useEffect(() => {
    if (reduceMotion) return;
    textOpacity.setValue(0);
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: motion.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [activeId, reduceMotion, textOpacity]);

  const stopAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current) {
      clearInterval(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  }, []);

  // Silently snaps back to the equivalent index in the middle lap once the
  // scroll position gets close to either end of the (very long, but finite)
  // repeated list — invisible to the user since every lap renders the same
  // 3 features. Runs both after manual drags and after each optimistic
  // auto-advance step (see `startAutoAdvance`), so it can't be skipped by
  // `onMomentumScrollEnd` not firing for a given programmatic scroll.
  const recenterIfNeeded = useCallback(
    (virtualIndex: number) => {
      const lap = Math.floor(virtualIndex / RING.length);
      if (lap >= EDGE_LAP_BUFFER && lap <= LAPS - 1 - EDGE_LAP_BUFFER) return;
      const offsetWithinRing = virtualIndex - lap * RING.length;
      const recentered = MIDDLE_LAP * RING.length + offsetWithinRing;
      virtualIndexRef.current = recentered;
      scrollX.setValue(recentered * snapInterval);
      listRef.current?.scrollToOffset({ offset: recentered * snapInterval, animated: false });
    },
    [scrollX, snapInterval],
  );

  // Ring order is [body, loads, photos] repeated, so from `loads` the
  // previous slot (index - 1) is `body` and the next slot (index + 1) is
  // `photos`. To make auto-rotation read as Cargas → Corpo → Fotos → Cargas
  // (the sequence the spec calls out), each tick moves the index *backward*
  // — that's the direction that visits body right after loads.
  //
  // `virtualIndexRef` is advanced optimistically here rather than solely
  // from `onMomentumScrollEnd`, because a programmatic `scrollToOffset`
  // isn't guaranteed to fire momentum-end events on every platform — relying
  // on that alone would let the ref go stale and stall auto-rotation after
  // the first tick.
  const startAutoAdvance = useCallback(() => {
    stopAutoAdvance();
    if (reduceMotion) return;
    autoAdvanceTimer.current = setInterval(() => {
      const next = virtualIndexRef.current - 1;
      virtualIndexRef.current = next;
      listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: true });
      recenterIfNeeded(next);
    }, AUTO_ADVANCE_INTERVAL_MS);
  }, [reduceMotion, stopAutoAdvance, snapInterval, recenterIfNeeded]);

  useEffect(() => {
    startAutoAdvance();
    return () => {
      stopAutoAdvance();
      clearResumeTimer();
    };
  }, [startAutoAdvance, stopAutoAdvance, clearResumeTimer]);

  const onScrollBeginDrag = useCallback(() => {
    isUserDraggingRef.current = true;
    stopAutoAdvance();
    clearResumeTimer();
  }, [stopAutoAdvance, clearResumeTimer]);

  // Also fires after the auto-advance timer's own `scrollToOffset` calls —
  // in that case there's no interaction to resume from, so only the index
  // sync + recenter matters; the resume timer is scheduled solely for real
  // user drags (tracked via `isUserDraggingRef`).
  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const virtualIndex = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
      virtualIndexRef.current = virtualIndex;
      recenterIfNeeded(virtualIndex);
      if (isUserDraggingRef.current) {
        isUserDraggingRef.current = false;
        clearResumeTimer();
        resumeTimer.current = setTimeout(startAutoAdvance, RESUME_AFTER_INTERACTION_MS);
      }
    },
    [snapInterval, recenterIfNeeded, clearResumeTimer, startAutoAdvance],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index == null) return;
      const feature = VIRTUAL_ITEMS[first.index];
      if (feature) setActiveId(feature.id);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
      }),
    [scrollX],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AjFitProgressFeature; index: number }) => {
      const inputRange = [(index - 1) * snapInterval, index * snapInterval, (index + 1) * snapInterval];
      const scale = reduceMotion
        ? 1
        : scrollX.interpolate({ inputRange, outputRange: [SIDE_SCALE, CENTER_SCALE, SIDE_SCALE], extrapolate: 'clamp' });
      const opacity = reduceMotion
        ? 1
        : scrollX.interpolate({ inputRange, outputRange: [SIDE_OPACITY, CENTER_OPACITY, SIDE_OPACITY], extrapolate: 'clamp' });
      const rotateY = reduceMotion
        ? '0deg'
        : scrollX.interpolate({
            inputRange,
            outputRange: [`${SIDE_ROTATE_DEG}deg`, '0deg', `-${SIDE_ROTATE_DEG}deg`],
            extrapolate: 'clamp',
          });
      const pull = reduceMotion
        ? 0
        : scrollX.interpolate({ inputRange, outputRange: [SIDE_PULL_PX, 0, -SIDE_PULL_PX], extrapolate: 'clamp' });

      return (
        <View style={{ width: itemWidth, alignItems: 'center' }}>
          <Animated.View
            style={{
              opacity,
              transform: [
                { perspective: PERSPECTIVE },
                { translateX: pull },
                { scale },
                { rotateY },
              ],
            }}
          >
            <PhoneFrame
              width={phoneWidth}
              cropRatio={PHONE_CROP_RATIO}
              image={item.image}
              placeholderIcon={item.icon}
              placeholderLabel={t('interstitials.ajFitProgress.screenshotPlaceholder', {
                index: RING.findIndex((f) => f.id === item.id) + 1,
              })}
              accessibilityLabel={t(`interstitials.ajFitProgress.features.${item.id}.title`)}
            />
          </Animated.View>
        </View>
      );
    },
    [itemWidth, phoneWidth, reduceMotion, scrollX, snapInterval, t],
  );

  return (
    // Negative margin cancels the screen's horizontal gutter so the row
    // spans the full window width — neighboring phones then get clipped
    // right at the physical screen edge instead of the content column's
    // inner edge, which is what makes them read as "peeking off-screen".
    <View style={{ width: rowWidth, alignSelf: 'center', marginHorizontal: -sizes.screenGutter }}>
      <Animated.FlatList
        ref={listRef}
        data={VIRTUAL_ITEMS}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        contentOffset={{ x: START_INDEX * snapInterval, y: 0 }}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={onScrollBeginDrag}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        accessibilityLabel={t('interstitials.ajFitProgress.carouselLabel')}
      />

      <CarouselIndicators
        count={RING.length}
        activeIndex={RING.findIndex((f) => f.id === activeId)}
      />

      <Animated.View
        style={{
          opacity: reduceMotion ? 1 : textOpacity,
          marginTop: spacing[3],
          alignItems: 'center',
          paddingHorizontal: spacing[4],
        }}
      >
        <Text style={{ fontFamily: theme.fonts.uiBold, fontSize: 18, color: theme.colors.textPrimary, textAlign: 'center' }}>
          {t(`interstitials.ajFitProgress.features.${activeId}.title`)}
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
          {t(`interstitials.ajFitProgress.features.${activeId}.body`)}
        </Text>
      </Animated.View>
    </View>
  );
}
