import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  State,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';
import type { GalleryPhoto } from '../../lib/photoVaultGallery';
import { tracePhotoVault } from '../../lib/photoVaultDevTrace';

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
 * Paging never widens what is decrypted beyond one swipe's reach. The gallery
 * keeps a bounded viewer WINDOW — the focused photo plus its two immediate
 * neighbours — and the screen hands it over on each page change rather than
 * letting it accumulate. Neighbours are prepared at prefetch priority, so they
 * only ever use a lane the focused photo is not using, and a page that falls
 * out of the window has its plaintext deleted rather than cached.
 *
 * This component asks for none of that itself: it renders whatever URI the
 * controller has published and never claims a photo or requests a decrypt.
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

/** Downward travel before the dismiss takes over from the pager. */
const DISMISS_ACTIVATION = 14;
/** Sideways travel that hands the gesture back to the horizontal pager. */
const DISMISS_FAIL_X = 18;
/** Drag far enough and it closes on release, however slowly it was dragged. */
const DISMISS_DISTANCE = 130;
/** …or flick it, and distance stops mattering. */
const DISMISS_VELOCITY = 900;
/** Travel over which the photo shrinks and the chrome fades out. */
const DISMISS_PROGRESS_RANGE = 320;

/**
 * Dots stop being readable long before a progress gallery stops growing, so
 * past this many photos the header's `3/47` counter is the honest affordance
 * and the dots are not rendered at all.
 */
const MAX_DOTS = 12;

/**
 * TEMPORARY runtime-only diagnostics for the physical-iPhone dismiss bug.
 *
 * Keep the payload deliberately limited to gesture/animation state. In
 * particular, never add a URI or photo id here. `tracePhotoVault` is also
 * development-only and sanitizes every field before writing it.
 */
function gestureStateName(state: number): string {
  switch (state) {
    case State.UNDETERMINED:
      return 'UNDETERMINED';
    case State.FAILED:
      return 'FAILED';
    case State.BEGAN:
      return 'BEGAN';
    case State.CANCELLED:
      return 'CANCELLED';
    case State.ACTIVE:
      return 'ACTIVE';
    case State.END:
      return 'END';
    default:
      return 'UNKNOWN';
  }
}

function traceViewerRuntime(event: string, fields?: Record<string, unknown>): void {
  const state = fields?.state;
  tracePhotoVault(event, {
    ...fields,
    ...(typeof state === 'number'
      ? { state: gestureStateName(state), stateCode: state }
      : null),
  });
}

/** Proves when the native Modal has actually released its React child tree. */
function ViewerModalRuntimeProbe() {
  useEffect(() => {
    traceViewerRuntime('viewerDismiss.modalContentMounted');
    return () => {
      traceViewerRuntime('viewerDismiss.unmounted', { scope: 'modalContent' });
    };
  }, []);

  return null;
}

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/**
 * How far through the dismiss the drag is: 0 at rest, 1 once released would
 * close it.
 *
 * Module scope and `'worklet'`, exactly like `clamp` above, because all three
 * of its callers are `useAnimatedStyle` bodies that run on the UI thread. A
 * plain arrow function declared in the component body looks identical at the
 * call site but is not callable from there — it throws
 * "Tried to synchronously call a non-worklet function on the UI thread" on
 * every single frame, starting the moment the screen mounts.
 */
function dismissProgress(value: number): number {
  'worklet';
  return interpolate(value, [0, DISMISS_PROGRESS_RANGE], [0, 1], Extrapolation.CLAMP);
}

/**
 * One pagination dot, driven by the pager's scroll offset.
 *
 * Reads `scrollX` rather than the parent's selected index on purpose. The
 * selected index only moves when a swipe SETTLES, because it also transfers
 * which photo is allowed to be decrypted — doing that mid-gesture would thrash
 * the vault. The dots have no such constraint, so they interpolate continuously
 * and track the finger, which is what makes the carousel feel connected.
 */
function PaginationDot({
  index,
  scrollX,
  pageWidth,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}) {
  const style = useAnimatedStyle(() => {
    const position = pageWidth > 0 ? scrollX.value / pageWidth : 0;
    // 1 on this page, 0 on any other, and a smooth blend in between.
    const proximity = clamp(1 - Math.abs(position - index), 0, 1);
    return {
      opacity: 0.3 + proximity * 0.7,
      transform: [{ scale: 0.75 + proximity * 0.45 }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.text,
        },
        style,
      ]}
    />
  );
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
  pageIndex,
  width,
  height,
  isActive,
  onZoomedChange,
  onRendered,
  label,
  hint,
}: {
  photo: GalleryPhoto;
  pageIndex: number;
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
    .onBegin((event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerTap.received', {
          source: 'photoDoubleTapCandidate',
          state: event.state,
          currentIndex: pageIndex,
          zoomed: scale.value > ZOOM_EPSILON,
        });
      }
    })
    .onEnd((event, success) => {
      if (scale.value > ZOOM_EPSILON) {
        if (__DEV__) {
          runOnJS(traceViewerRuntime)('viewerTap.action', {
            source: 'photoDoubleTap',
            action: 'resetZoom',
            state: event.state,
            success,
            currentIndex: pageIndex,
          });
        }
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerTap.action', {
          source: 'photoDoubleTap',
          action: 'zoomIn',
          state: event.state,
          success,
          currentIndex: pageIndex,
        });
      }
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      runOnJS(reportZoom)(true);
    })
    .onFinalize((event, success) => {
      if (__DEV__ && !success) {
        runOnJS(traceViewerRuntime)('viewerTap.action', {
          source: 'photoDoubleTapCandidate',
          action: 'none',
          reason: 'gestureFailedOrCancelled',
          state: event.state,
          success,
          currentIndex: pageIndex,
        });
      }
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
  const { height: windowHeight } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);
  /** Live pager offset. Drives the dots without going through React state. */
  const scrollX = useSharedValue(0);
  /** How far the viewer has been dragged down, in points. Never negative. */
  const dragY = useSharedValue(0);
  /** Reduces DEV logging overhead while retaining a useful update timeline. */
  const dismissUpdateSequence = useSharedValue(0);
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

  const viewerRuntimeRef = useRef({ visible, index });
  viewerRuntimeRef.current = { visible, index };

  const closeViewer = useCallback(() => {
    traceViewerRuntime('viewerDismiss.closeViewerCalled', {
      modalVisible: viewerRuntimeRef.current.visible,
      currentIndex: viewerRuntimeRef.current.index,
    });
    // Cleared on the tap itself, before any teardown scroll event exists.
    acceptsPagingRef.current = false;
    onClose();
  }, [onClose]);

  const handleModalDismissed = useCallback(() => {
    traceViewerRuntime('viewerDismiss.modalDismissed', {
      currentIndex: viewerRuntimeRef.current.index,
    });
    // On iOS, `onDismiss` runs only after the native Modal has stopped
    // presenting its children. Keep the completed drag in place until then so
    // the outgoing photo cannot jump back to the centre during teardown.
    // This zero is therefore preparation for the next opening, not part of the
    // current closing animation.
    dragY.value = 0;
  }, [dragY]);

  useEffect(() => {
    traceViewerRuntime('viewerDismiss.modalVisibleChanged', {
      visible,
      currentIndex: viewerRuntimeRef.current.index,
    });
  }, [visible]);

  useEffect(() => () => {
    traceViewerRuntime('viewerDismiss.unmounted', {
      scope: 'viewerComponent',
      modalVisible: viewerRuntimeRef.current.visible,
      currentIndex: viewerRuntimeRef.current.index,
    });
  }, []);

  // React state can be cleared as soon as closing starts. The visual drag is
  // deliberately left untouched until `handleModalDismissed`, while the old
  // native Modal may still be presenting its children.
  useEffect(() => {
    if (!visible) {
      setZoomed(false);
      acceptsPagingRef.current = false;
    }
  }, [visible]);

  // `initialScrollIndex` sets the pager's offset natively, and no scroll event
  // follows it — so without this the dots would start on the first photo no
  // matter which one was actually opened.
  useEffect(() => {
    if (visible && page && page.width > 0) {
      scrollX.value = initialIndexRef.current * page.width;
    }
  }, [page, scrollX, visible]);

  const handleScroll = useAnimatedScrollHandler({
    onBeginDrag: (event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerPager.beginDrag', {
          offsetX: event.contentOffset.x,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    },
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
    onEndDrag: (event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerPager.endDrag', {
          offsetX: event.contentOffset.x,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    },
    onMomentumBegin: (event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerPager.momentumBegin', {
          offsetX: event.contentOffset.x,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    },
    onMomentumEnd: (event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerPager.momentumEnd', {
          offsetX: event.contentOffset.x,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    },
  });

  /**
   * Drag down to dismiss.
   *
   * Deliberately narrow so it never competes for a gesture that belongs to
   * something else: it waits for real downward travel before taking over, and
   * gives up entirely the moment the drag turns sideways, which is what keeps
   * the horizontal pager working. It is also disabled while zoomed in, where
   * dragging means panning around the photo instead.
   */
  const dismissGesture = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY(DISMISS_ACTIVATION)
    .failOffsetX([-DISMISS_FAIL_X, DISMISS_FAIL_X])
    .onBegin((event) => {
      dismissUpdateSequence.value = 0;
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerGesture.begin', {
          state: event.state,
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    })
    .onStart((event) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerGesture.start', {
          state: event.state,
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    })
    .onUpdate((event) => {
      // Downward only: dragging back up past the start just rests at zero
      // rather than lifting the photo off the top of the screen.
      dragY.value = Math.max(0, event.translationY);
      dismissUpdateSequence.value += 1;
      if (__DEV__ && (dismissUpdateSequence.value === 1 || dismissUpdateSequence.value % 4 === 0)) {
        runOnJS(traceViewerRuntime)('viewerGesture.update', {
          update: dismissUpdateSequence.value,
          state: event.state,
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          translateY: dragY.value,
          currentIndex: index,
        });
      }
    })
    .onEnd((event, success) => {
      const shouldDismiss =
        dragY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY;
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerGesture.end', {
          state: event.state,
          success,
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          translateY: dragY.value,
          shouldDismiss,
          currentIndex: index,
        });
      }
      if (shouldDismiss) {
        // Leaves in the direction the finger was already going, fast enough to
        // read as "gone the moment I let go" rather than as an outro to sit
        // through. The close is handed to JS only once it is actually off
        // screen — reporting earlier tears the Modal down under the gesture.
        if (__DEV__) {
          runOnJS(traceViewerRuntime)('viewerDismiss.animationStarted', {
            animation: 'dismissTiming',
            from: dragY.value,
            to: 'screenBottom',
            gestureSuccess: success,
            currentIndex: index,
          });
        }
        dragY.value = withTiming(windowHeight, { duration: 140 }, (finished) => {
          if (__DEV__) {
            runOnJS(traceViewerRuntime)(
              finished
                ? 'viewerDismiss.animationFinished'
                : 'viewerDismiss.animationCancelled',
              {
                animation: 'dismissTiming',
                finished: finished === true,
                translateY: dragY.value,
                currentIndex: index,
              },
            );
          }
          if (finished) runOnJS(closeViewer)();
        });
        return;
      }
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerDismiss.animationStarted', {
          animation: 'snapBackSpring',
          from: dragY.value,
          to: 0,
          gestureSuccess: success,
          currentIndex: index,
        });
      }
      dragY.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.6 }, (finished) => {
        if (__DEV__) {
          runOnJS(traceViewerRuntime)(
            finished
              ? 'viewerDismiss.animationFinished'
              : 'viewerDismiss.animationCancelled',
            {
              animation: 'snapBackSpring',
              finished: finished === true,
              translateY: dragY.value,
              currentIndex: index,
            },
          );
        }
      });
    })
    .onFinalize((event, success) => {
      if (__DEV__) {
        runOnJS(traceViewerRuntime)('viewerGesture.finalize', {
          state: event.state,
          success,
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          translateY: dragY.value,
          shouldDismiss:
            dragY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY,
          currentIndex: index,
        });
      }
    });

  /**
   * Only the photo moves, and only ever along Y.
   *
   * It deliberately does NOT scale. A scale transform here lands on the native
   * horizontal paging scroll view, whose page geometry is the thing the pager
   * is mid-way through resolving during a swipe — scaling it while it is
   * settling is what made the photo render askew and then jump.
   */
  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: clamp(1 - dismissProgress(dragY.value) * 0.65, 0, 1),
  }));

  // The chrome fades in place rather than riding down with the photo, so what
  // leaves the screen is the photo alone.
  //
  // Clamped, and not merely scaled: `1 - progress * 1.6` bottoms out at -0.6,
  // and a negative opacity is not a dimmer view — it is an invalid value that
  // renders as corruption.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: clamp(1 - dismissProgress(dragY.value) * 1.6, 0, 1),
  }));

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
    ({ item, index: pageIndex }: { item: GalleryPhoto; index: number }) => (
      <ZoomablePhoto
        photo={item}
        pageIndex={pageIndex}
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

  const showDots = photos.length > 1 && photos.length <= MAX_DOTS;

  return (
    <Modal
      visible={visible}
      animationType="none"
      // Transparent so the backdrop is ours to animate: dragging the photo away
      // has to uncover something, and an opaque Modal has nothing to uncover.
      transparent
      onRequestClose={closeViewer}
      onShow={() => traceViewerRuntime('viewerDismiss.modalShown', { currentIndex: index })}
      onDismiss={handleModalDismissed}
      statusBarTranslucent
    >
      {/* Gestures inside a native Modal need their own root: the app-level one
          lives in a different native view hierarchy and never sees these. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ViewerModalRuntimeProbe />
        {/* A native Modal has its own root view. Its own provider is required so
            the inset is measured against that window instead of resolving to
            zero and placing actions under the status bar/Dynamic Island. */}
        <SafeAreaProvider style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {/* Full-strength black at rest, so the viewer is opaque exactly as
                before until a drag actually starts. */}
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}
            />
            <GestureDetector gesture={dismissGesture}>
            {/*
              Everything below stays in its laid-out position; only the photo
              layer translates.

              This used to be one transformed wrapper around the whole tree,
              which put `onLayout={measurePage}` inside the transform. Layout
              events fired while the transform ran, `page` was re-set mid-drag,
              and `getItemLayout`/`initialScrollIndex` changed underneath a
              pager that was still settling — the photo came out askew and the
              list jumped. Keeping the measured box static removes that whole
              class of problem.
            */}
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'right', 'bottom', 'left']}>
              <Animated.View
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 18,
                    // Intentional spacing after the provider-measured safe area.
                    paddingTop: 12,
                    paddingBottom: 12,
                  },
                  chromeStyle,
                ]}
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
                    {/* Where the dots cannot go — a gallery too long to dot —
                        the counter carries the position instead. */}
                    {photos.length > 1 && !showDots ? (
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
              </Animated.View>

              {/* The pager fills whatever is left after the header, and that
                  box — not the window — is what a page is sized to. Static by
                  design: nothing transforms this view, so its measurement can
                  never change because of a gesture. */}
              <View style={{ flex: 1 }} onLayout={measurePage}>
                {page ? (
                  <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
                  <Animated.FlatList
                    data={photos}
                    keyExtractor={(item) => (item as GalleryPhoto).photoId}
                    renderItem={renderItem}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    // A zoomed page owns the drag; re-enabling on zoom-out is
                    // what keeps swiping available again.
                    scrollEnabled={!zoomed}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
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
                  </Animated.View>
                ) : null}
              </View>

              {/* Position, as a strip under the photo. Announced once, from the
                  settled index — the dots themselves are decoration and are
                  hidden from assistive tech so the position is not read out
                  again for every dot. */}
              {showDots ? (
                <Animated.View
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('progress.photos.a11y.photoPosition', {
                    current: index + 1,
                    total: photos.length,
                  })}
                  style={[
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      paddingTop: 14,
                      paddingBottom: 10,
                    },
                    chromeStyle,
                  ]}
                >
                  {photos.map((item, dotIndex) => (
                    <PaginationDot
                      key={item.photoId}
                      index={dotIndex}
                      scrollX={scrollX}
                      pageWidth={page?.width ?? 0}
                    />
                  ))}
                </Animated.View>
              ) : null}

              {photo?.fullLoading ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    // Clears the dot strip when there is one.
                    bottom: showDots ? 58 : 28,
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
            </GestureDetector>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}
