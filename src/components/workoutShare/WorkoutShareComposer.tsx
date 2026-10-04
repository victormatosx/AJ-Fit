import {
  createRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { resolvePhotoActionsMode, shouldShowRemovePhotoButton } from '../../workoutShare/composerUi';
import type { WorkoutShareData } from '../../workoutShare/data';
import type { Sex } from '../../state/AppState';
import { captureWorkoutSharePoster } from '../../workoutShare/export';
import { cleanupWorkoutShareFiles } from '../../workoutShare/files';
import { DEFAULT_WORKOUT_SHARE_LAYOUT_ID, workoutShareLayoutIndex } from '../../workoutShare/layouts';
import { discardWorkoutSharePhoto, pickWorkoutSharePhoto } from '../../workoutShare/media';
import { preloadAjLogo, preloadAjLogoWhite } from '../../workoutShare/logo';
import { preloadWorkoutShareGymArt } from '../../workoutShare/backgroundArt';
import { createWorkoutShareController, type WorkoutShareDestination } from '../../workoutShare/share';
import { logInfo, logWarn } from '../../lib/logger';
import { WORKOUT_SHARE_POSTERS } from './posters/registry';
import type { WorkoutSharePhoto } from './posters/types';
import { ShareToRow } from './ShareToRow';

type Photo = WorkoutSharePhoto;

type Props = {
  sex: Sex;
  data: WorkoutShareData;
  /**
   * This composer is the post-workout terminal screen — there is no prior
   * screen to return to. The header close is the only exit; it runs the
   * exact same finish/cleanup path the old WorkoutDone "Back to home" CTA
   * used to.
   */
  onDone: () => void;
};

// Every layout shares one canvas (9:16, 1080x1920 export) — see
// `workoutShare/layouts.ts`. The preview box is therefore simply
// `aspectRatio: 9/16`; only its on-screen SIZE changes in this pass (never
// the export, never the poster content). With the model-thumbnail strip
// gone, the freed vertical space goes straight back into a bigger preview.
const PREVIEW_ASPECT_RATIO = 9 / 16;
const PREVIEW_WIDTH_RATIO = 0.78;
const PREVIEW_MIN_WIDTH = 190;
const PREVIEW_MAX_WIDTH = 270;

const DEFAULT_SELECTED_INDEX = workoutShareLayoutIndex(DEFAULT_WORKOUT_SHARE_LAYOUT_ID);

function IconAction({ label, icon, disabled, onPress }: {
  label: string;
  icon: 'camera' | 'plus' | 'swap';
  disabled: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={{ minWidth: 64, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 7, opacity: disabled ? 0.5 : 1 }}
    >
      <Icon name={icon} size={22} color={theme.colors.textPrimary} />
      <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.uiSemi, fontSize: 11 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// A fixed-width slot on each side of the poster box, outside it, reserved
// whether or not an arrow renders there — so the poster stays perfectly
// centered regardless of how many arrows are showing.
const ARROW_SLOT_WIDTH = 34;

/**
 * Minimalist side arrow hinting that tapping or dragging switches designs —
 * just the glyph (white, semi-transparent), no circle/background, and it
 * lives outside the poster box entirely (not overlaid on the photo). Only
 * rendered when there's actually a model on that side.
 */
function ModelNavArrow({ direction, label, onPress }: {
  direction: 'left' | 'right';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={14}
      style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }}
    >
      <Icon name={direction === 'left' ? 'arrow-left' : 'arrow-right'} size={20} color="rgba(255,255,255,0.75)" />
    </Pressable>
  );
}

/** Tiny page indicator only — never a model preview. Tap still works, but swiping the poster itself is the primary way to switch designs. */
function PageDots({ selectedIndex, onSelect }: { selectedIndex: number; onSelect: (index: number) => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 10 }}>
      {WORKOUT_SHARE_POSTERS.map((poster, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={poster.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={8}
            onPress={() => onSelect(index)}
            style={{
              width: selected ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: selected ? theme.colors.primaryEmphasis : theme.colors.controlBackground,
            }}
          />
        );
      })}
    </View>
  );
}

export function WorkoutShareComposer({ sex, data, onDone }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation(['workout', 'common']);
  const scrollRef = useRef<ScrollView>(null);
  const shareFlightRef = useRef(false);
  const controller = useMemo(() => createWorkoutShareController(), []);

  // One stable ref per layout — the carousel can have up to 3 pages mounted
  // at once (windowed rendering), so a single shared ref isn't enough; only
  // the currently selected layout's ref is ever read at share time.
  const posterRefs = useMemo(() => {
    const refs: Record<string, RefObject<View | null>> = {};
    for (const poster of WORKOUT_SHARE_POSTERS) refs[poster.id] = createRef<View>();
    return refs;
  }, []);

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(DEFAULT_SELECTED_INDEX);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPoster = WORKOUT_SHARE_POSTERS[selectedIndex] ?? WORKOUT_SHARE_POSTERS[0];

  // Mount-once: this screen is only ever rendered once per finished workout
  // (WorkoutScreen's `finished` branch), so there is no `visible` toggle to
  // react to anymore.
  useEffect(() => {
    cleanupWorkoutShareFiles();
    // Fire-and-forget: decodes/caches the logo once (default + white-tinted
    // variants) so every poster (and every model swap) reads the same
    // in-memory ImageRef instead of each one resolving/decoding the asset
    // independently.
    void preloadAjLogo();
    void preloadAjLogoWhite();
    void preloadWorkoutShareGymArt();
    logInfo('workout_share', 'workout_share_composer_opened');
  }, []);

  const choosePhoto = useCallback(async (source: 'camera' | 'library') => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await pickWorkoutSharePhoto(source);
    if (result.status === 'picked') {
      discardWorkoutSharePhoto(photo?.uri ?? null);
      setPhoto({ uri: result.uri, width: result.width, height: result.height });
      logInfo('workout_share', source === 'camera'
        ? 'workout_share_photo_camera_selected'
        : 'workout_share_photo_library_selected');
    } else if (result.status === 'permissionDenied') {
      setMessage(t('done.shareComposer.permissionDenied'));
    } else if (result.status === 'failed') {
      setMessage(t('done.shareComposer.photoFailed'));
    }
    setBusy(false);
  }, [busy, photo?.uri, t]);

  const removePhoto = useCallback(() => {
    if (busy) return;
    discardWorkoutSharePhoto(photo?.uri ?? null);
    setPhoto(null);
    setMessage(null);
    logInfo('workout_share', 'workout_share_no_photo_selected');
  }, [busy, photo?.uri]);

  const share = useCallback(async (destination: WorkoutShareDestination) => {
    if (busy || shareFlightRef.current || controller.isSharing()) return;
    shareFlightRef.current = true;
    setBusy(true);
    setMessage(t('done.shareComposer.generating'));
    try {
      // Always the layout currently in view — never a poster scrolled out of
      // focus, regardless of what else may still be mounted for windowing.
      const ref = posterRefs[selectedPoster.id];
      const uri = await captureWorkoutSharePoster(ref, {
        width: selectedPoster.exportWidth,
        height: selectedPoster.exportHeight,
      });
      logInfo('workout_share', 'workout_share_image_generated', { layout: selectedPoster.id });
      logInfo('workout_share', 'workout_share_destination_pressed', { destination });
      setMessage(t('done.shareComposer.sharing'));
      const result = await controller.share(uri, destination);
      if (result.status === 'fallback') setMessage(t('done.shareComposer.destinationFallback'));
      else if (result.status === 'unavailable') setMessage(t('done.shareComposer.shareUnavailable'));
      else setMessage(null);
    } catch (error) {
      logWarn('workout_share', 'workout_share_failed', { error });
      setMessage(t('done.shareComposer.shareFailed'));
    } finally {
      shareFlightRef.current = false;
      setBusy(false);
    }
  }, [busy, controller, posterRefs, selectedPoster, t]);

  const finish = useCallback(() => {
    if (busy) return;
    discardWorkoutSharePhoto(photo?.uri ?? null);
    setPhoto(null);
    setMessage(null);
    onDone();
  }, [busy, onDone, photo?.uri]);

  const onPreviewLayout = (event: LayoutChangeEvent) => {
    setPreviewWidth(Math.floor(event.nativeEvent.layout.width));
  };
  const previewHeight = previewWidth / PREVIEW_ASPECT_RATIO;

  const updateSelectedIndexFromOffset = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (previewWidth <= 0) return;
    const raw = event.nativeEvent.contentOffset.x / previewWidth;
    const index = Math.max(0, Math.min(WORKOUT_SHARE_POSTERS.length - 1, Math.round(raw)));
    setSelectedIndex((current) => (current === index ? current : index));
  }, [previewWidth]);

  const scrollToIndex = useCallback((index: number) => {
    scrollRef.current?.scrollTo({ x: index * previewWidth, animated: true });
    setSelectedIndex(index);
  }, [previewWidth]);

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={finish}>
      {/* This is the post-workout terminal screen — there is no screen
          underneath it anymore. A native Modal still gives this surface its
          own inset provider, so notch/status/navigation-bar metrics are
          measured independently and can never leak into the exported
          poster canvas. */}
      <SafeAreaProvider style={{ flex: 1 }}>
        <SafeAreaView
          style={{ flex: 1, backgroundColor: theme.colors.background }}
          edges={['top', 'right', 'bottom', 'left']}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('done.shareComposer.close')} disabled={busy} onPress={finish} hitSlop={6} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
              <Icon name="x" size={18} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 17, letterSpacing: 0.8 }}>
              {t('done.shareComposer.title').toUpperCase()}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Preview row: the poster box (a horizontal, paging carousel —
                dragging it left/right switches designs directly) centered
                between two fixed-width arrow slots that live OUTSIDE the
                box. Both slots are always reserved, arrow or not, so the
                poster never shifts depending on how many arrows show. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center' }}>
                {selectedIndex > 0 ? (
                  <ModelNavArrow
                    direction="left"
                    label={t('done.shareComposer.previousModel')}
                    onPress={() => scrollToIndex(selectedIndex - 1)}
                  />
                ) : null}
              </View>

              {/* The remove-photo X is a SIBLING of the carousel (never a
                  descendant of any poster's own ref'd view), so it stays out
                  of whatever `captureWorkoutSharePoster`/view-shot captures. */}
              <View
                onLayout={onPreviewLayout}
                style={{
                  flexShrink: 1,
                  width: `${PREVIEW_WIDTH_RATIO * 100}%`,
                  minWidth: PREVIEW_MIN_WIDTH,
                  maxWidth: PREVIEW_MAX_WIDTH,
                  aspectRatio: PREVIEW_ASPECT_RATIO,
                }}
              >
                {previewWidth > 0 ? (
                  <ScrollView
                    ref={scrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={updateSelectedIndexFromOffset}
                    scrollEventThrottle={16}
                    style={{ borderRadius: 16 }}
                    testID="workout-share-poster-carousel"
                  >
                    {WORKOUT_SHARE_POSTERS.map((poster, index) => {
                      // Windowed rendering: only the selected page and its
                      // immediate neighbors mount real poster content, so
                      // swiping stays cheap — nothing captures/generates an
                      // image just from scrolling past a design.
                      const mounted = Math.abs(index - selectedIndex) <= 1;
                      const PosterComponent = poster.Component;
                      return (
                        <View
                          key={poster.id}
                          style={{ width: previewWidth, height: previewHeight, borderRadius: 16, overflow: 'hidden', backgroundColor: '#03010F' }}
                        >
                          {mounted ? (
                            <PosterComponent
                              sex={sex}
                              data={data}
                              photo={photo}
                              width={previewWidth}
                              height={previewHeight}
                              posterRef={posterRefs[poster.id]}
                            />
                          ) : null}
                        </View>
                      );
                    })}
                  </ScrollView>
                ) : null}

                {shouldShowRemovePhotoButton(photo?.uri) ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('done.shareComposer.removePhoto')}
                    disabled={busy}
                    onPress={removePhoto}
                    hitSlop={10}
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 30,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Icon name="x" size={14} color="#FFFFFF" />
                  </Pressable>
                ) : null}
              </View>

              <View style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center' }}>
                {selectedIndex < WORKOUT_SHARE_POSTERS.length - 1 ? (
                  <ModelNavArrow
                    direction="right"
                    label={t('done.shareComposer.nextModel')}
                    onPress={() => scrollToIndex(selectedIndex + 1)}
                  />
                ) : null}
              </View>
            </View>

            <PageDots selectedIndex={selectedIndex} onSelect={scrollToIndex} />

            <View style={{ marginTop: 18, alignItems: 'center' }}>
              {resolvePhotoActionsMode(photo?.uri) === 'change' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('done.shareComposer.changePhoto')}
                  disabled={busy}
                  onPress={() => { void choosePhoto('library'); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4, opacity: busy ? 0.5 : 1 }}
                >
                  <Icon name="swap" size={14} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textSecondary, fontFamily: theme.fonts.uiSemi, fontSize: 12 }}>
                    {t('done.shareComposer.changePhoto')}
                  </Text>
                </Pressable>
              ) : (
                <View style={{ flexDirection: 'row', gap: 22 }}>
                  <IconAction label={t('done.shareComposer.library')} icon="plus" disabled={busy} onPress={() => { void choosePhoto('library'); }} />
                  <IconAction label={t('done.shareComposer.camera')} icon="camera" disabled={busy} onPress={() => { void choosePhoto('camera'); }} />
                </View>
              )}
            </View>

            {message ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, textAlign: 'center', fontFamily: theme.fonts.uiMed, fontSize: 13, marginTop: 14 }}>
                {message}
              </Text>
            ) : null}

            {/* Inline "Compartilhar em" row — no destination modal. Tapping
                any destination captures the current poster and hands off
                directly; ShareToRow only renders the registry, all
                platform-specific behavior lives in workoutShare/share.ts. */}
            <ShareToRow
              disabled={busy || previewWidth === 0}
              onSelect={(id) => { void share(id); }}
            />
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
