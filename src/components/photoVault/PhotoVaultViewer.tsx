import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';
import type { GalleryPhoto } from '../../lib/photoVaultGallery';

/**
 * Full-screen viewer for the decrypted photos, one page per photo.
 *
 * Renders only while the current photo still has a live URI. The parent drops
 * that URI the moment the vault locks, so the viewer disappears with it —
 * there is no path where a decrypted image outlives the lock.
 *
 * Images stay in plain `<Image>` elements with no cache configuration. That is
 * deliberate and must not be swapped for a caching component: these are
 * decrypted vault photos, and a disk cache would persist plaintext outside the
 * vault's own lifecycle.
 *
 * Paging never widens what is decrypted. The gallery keeps a single viewer
 * owner (`viewerOwnerId`), so only the focused photo is fetched at full
 * resolution; neighbouring pages show the thumbnail the grid already holds
 * until they become the focused one. Swiping hands that ownership over — it
 * does not accumulate it.
 */

interface Props {
  /** The visible photos, in the order the grid paints them. */
  photos: GalleryPhoto[];
  /** Which photo is open; `null` closes the viewer. */
  photoId: string | null;
  formatDate: (date: Date) => string;
  onClose: () => void;
  onDelete: (photoId: string) => void;
  onRendered: (photoId: string, fullRendered: boolean) => void;
  /** Paging moved to another photo: the parent moves the vault claim with it. */
  onNavigate: (photoId: string) => void;
  deleting: boolean;
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** Anything at or below this counts as "not zoomed", absorbing float drift. */
const ZOOM_EPSILON = 1.01;

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

function displayUriOf(photo: GalleryPhoto): string | null {
  // The thumbnail opens immediately; full replaces it when its decrypt lands.
  return photo.fullUri ?? photo.thumbnailUri ?? photo.previewUri ?? null;
}

/**
 * One page: pinch, double-tap and drag-while-zoomed over a single photo.
 *
 * Panning is enabled only while zoomed in. At rest the horizontal drag has to
 * reach the pager underneath — otherwise the gesture would be swallowed here
 * and swiping between photos would stop working.
 */
function ZoomablePhoto({
  photo,
  width,
  height,
  isActive,
  onZoomedChange,
  onRendered,
  label,
  hint,
}: {
  photo: GalleryPhoto;
  width: number;
  height: number;
  isActive: boolean;
  onZoomedChange: (zoomed: boolean) => void;
  onRendered: (photoId: string, fullRendered: boolean) => void;
  label: string;
  hint: string;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const uri = displayUriOf(photo);

  const reportZoom = useCallback(
    (next: boolean) => {
      setZoomed(next);
      onZoomedChange(next);
    },
    [onZoomedChange],
  );

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  // A page that scrolls out of focus must not keep its zoom: coming back to it
  // later should start from the whole photo, and a zoomed-in inactive page
  // would also keep the pager disabled.
  useEffect(() => {
    if (isActive) return;
    resetZoom();
    setZoomed(false);
  }, [isActive, resetZoom]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value <= ZOOM_EPSILON) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      savedScale.value = scale.value;
      // Shrinking can leave the photo translated past its new bounds.
      const maxX = (width * (scale.value - 1)) / 2;
      const maxY = (height * (scale.value - 1)) / 2;
      translateX.value = clamp(translateX.value, -maxX, maxX);
      translateY.value = clamp(translateY.value, -maxY, maxY);
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(reportZoom)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate((event) => {
      const maxX = Math.max(0, (width * (scale.value - 1)) / 2);
      const maxY = Math.max(0, (height * (scale.value - 1)) / 2);
      translateX.value = clamp(savedTranslateX.value + event.translationX, -maxX, maxX);
      translateY.value = clamp(savedTranslateY.value + event.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      if (scale.value > ZOOM_EPSILON) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      runOnJS(reportZoom)(true);
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (!uri) return <View style={{ width, height }} />;

  return (
    <GestureDetector gesture={gesture}>
      {/* The page is exactly the pager's viewport, and the photo is centred in
          it on both axes. `contain` then letterboxes anything that is not the
          screen's aspect ratio without ever cropping it. */}
      <View
        style={{
          width,
          height,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Image
            source={{ uri }}
            resizeMode="contain"
            onLoad={() => {
              if (isActive) onRendered(photo.photoId, photo.fullUri === uri);
            }}
            accessibilityRole="image"
            accessibilityLabel={label}
            accessibilityHint={hint}
            style={{ width, height }}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

export function PhotoVaultViewer({
  photos,
  photoId,
  formatDate,
  onClose,
  onDelete,
  onRendered,
  onNavigate,
  deleting,
}: Props) {
  const { t } = useTranslation('home');
  const [zoomed, setZoomed] = useState(false);
  /**
   * The pager's real viewport, measured rather than assumed.
   *
   * Deliberately NOT `useWindowDimensions()`: the list sits below the header
   * and inside the safe area, so the window is taller than what it actually
   * occupies. Sizing pages to the window centres each photo inside a box
   * taller than the visible one, which pushes anything that does not fill the
   * screen below the true centre and clips its bottom edge.
   */
  const [page, setPage] = useState<{ width: number; height: number } | null>(null);

  const measurePage = useCallback((event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setPage((current) =>
      current && current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight },
    );
  }, []);

  const index = photoId === null ? -1 : photos.findIndex((p) => p.photoId === photoId);
  const photo = index >= 0 ? photos[index]! : null;
  const visible = photo !== null && displayUriOf(photo) !== null;

  // The page the viewer opens on.
  //
  // Captured on the transition into visible, not on every render: after that
  // the list owns the scroll position, and re-syncing it from `photoId` would
  // fight the user's own swipe. A closed Modal renders null, so its children
  // remount on each opening and read this fresh.
  const initialIndexRef = useRef(0);
  const wasVisibleRef = useRef(false);
  /**
   * Whether a paging event may still move the parent's selection.
   *
   * A closing list emits one last momentum event as it tears down. Reporting
   * that page would hand a photo id back to the parent and reopen the viewer
   * the user just dismissed — an endless open/close loop. Kept in a ref, not
   * state: it is read when the native event fires, so a callback created
   * before the close cannot act on a stale value.
   */
  const acceptsPagingRef = useRef(false);

  const justOpened = visible && !wasVisibleRef.current;
  if (justOpened) {
    initialIndexRef.current = Math.max(0, index);
    acceptsPagingRef.current = true;
  }
  wasVisibleRef.current = visible;

  const closeViewer = useCallback(() => {
    // Cleared on the tap itself, before any teardown scroll event exists.
    acceptsPagingRef.current = false;
    onClose();
  }, [onClose]);

  // Closing must not leave the next opening stuck with the pager disabled.
  useEffect(() => {
    if (!visible) {
      setZoomed(false);
      acceptsPagingRef.current = false;
    }
  }, [visible]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // `photoId === null` covers a close driven by the parent (lock, delete),
      // where no tap passed through `closeViewer`.
      if (!acceptsPagingRef.current || photoId === null || !page || page.width <= 0) return;
      const next = Math.round(event.nativeEvent.contentOffset.x / page.width);
      const target = photos[next];
      if (target && target.photoId !== photoId) onNavigate(target.photoId);
    },
    [onNavigate, page, photoId, photos],
  );

  const renderItem = useCallback(
    ({ item }: { item: GalleryPhoto }) => (
      <ZoomablePhoto
        photo={item}
        width={page?.width ?? 0}
        height={page?.height ?? 0}
        isActive={item.photoId === photoId}
        onZoomedChange={setZoomed}
        onRendered={onRendered}
        label={t('progress.photos.a11y.photo', { date: formatDate(item.takenAt) })}
        hint={t('progress.photos.a11y.zoomHint')}
      />
    ),
    [formatDate, onRendered, page, photoId, t],
  );

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={closeViewer}
      statusBarTranslucent
    >
      {/* Gestures inside a native Modal need their own root: the app-level one
          lives in a different native view hierarchy and never sees these. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* A native Modal has its own root view. Its own provider is required so
            the inset is measured against that window instead of resolving to
            zero and placing actions under the status bar/Dynamic Island. */}
        <SafeAreaProvider style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom', 'left']}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 18,
                  // Intentional spacing after the provider-measured safe area.
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
              >
                <Pressable
                  onPress={closeViewer}
                  accessibilityRole="button"
                  accessibilityLabel={t('progress.photos.a11y.closeViewer')}
                  hitSlop={12}
                  style={{ padding: 6 }}
                >
                  <Icon name="x" size={22} color={colors.text} />
                </Pressable>

                {photo ? (
                  <View style={{ alignItems: 'center' }}>
                    <Text
                      style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 13 }}
                    >
                      {formatDate(photo.takenAt)}
                    </Text>
                    {photos.length > 1 ? (
                      <Text
                        accessibilityLabel={t('progress.photos.a11y.photoPosition', {
                          current: index + 1,
                          total: photos.length,
                        })}
                        style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 11 }}
                      >
                        {`${index + 1}/${photos.length}`}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                <Pressable
                  onPress={() => photo && onDelete(photo.photoId)}
                  disabled={deleting || !photo}
                  accessibilityRole="button"
                  accessibilityLabel={t('progress.photos.a11y.deletePhoto')}
                  accessibilityState={{ disabled: deleting || !photo }}
                  hitSlop={12}
                  style={{ padding: 6, opacity: deleting ? 0.4 : 1 }}
                >
                  <Icon name="trash" size={20} color={colors.text} />
                </Pressable>
              </View>

              {/* The pager fills whatever is left after the header, and that
                  box — not the window — is what a page is sized to. */}
              <View style={{ flex: 1 }} onLayout={measurePage}>
                {page ? (
                  <FlatList
                    data={photos}
                    keyExtractor={(item) => item.photoId}
                    renderItem={renderItem}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    // A zoomed page owns the drag; re-enabling on zoom-out is
                    // what keeps swiping available again.
                    scrollEnabled={!zoomed}
                    onMomentumScrollEnd={handleMomentumEnd}
                    // Mounted only once measured: `initialScrollIndex` resolves
                    // to an offset through `getItemLayout`, so a zero width
                    // here would open every photo on the first page.
                    initialScrollIndex={initialIndexRef.current}
                    getItemLayout={(_, i) => ({
                      length: page.width,
                      offset: page.width * i,
                      index: i,
                    })}
                    // One page each side: enough for the swipe to reveal a
                    // neighbour immediately, without holding the whole gallery.
                    windowSize={3}
                    initialNumToRender={1}
                    maxToRenderPerBatch={2}
                    style={{ flex: 1 }}
                  />
                ) : null}
              </View>

              {photo?.fullLoading ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 28,
                    alignItems: 'center',
                  }}
                >
                  <View
                    style={{
                      borderRadius: 16,
                      backgroundColor: 'rgba(0,0,0,0.55)',
                      padding: 9,
                    }}
                  >
                    <ActivityIndicator color={colors.text} size="small" />
                  </View>
                </View>
              ) : null}
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}
