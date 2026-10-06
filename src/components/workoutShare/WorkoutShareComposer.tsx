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
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { File } from 'expo-file-system';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';
import { resolvePhotoActionsMode, shouldShowRemovePhotoButton } from '../../workoutShare/composerUi';
import type { WorkoutShareData } from '../../workoutShare/data';
import type { Sex } from '../../state/AppState';
import { captureWorkoutSharePoster } from '../../workoutShare/export';
import { captureWorkoutShareArt, workoutShareArtRenderSize } from '../../workoutShare/exportArt';
import { cleanupWorkoutShareFiles, discardWorkoutShareFile } from '../../workoutShare/files';
import { DEFAULT_WORKOUT_SHARE_LAYOUT_ID, workoutShareLayoutIndex } from '../../workoutShare/layouts';
import { isWorkoutShareArtLayoutAvailable } from '../../workoutShare/artLayouts';
import { discardWorkoutSharePhoto, pickWorkoutSharePhoto } from '../../workoutShare/media';
import { preloadAjLogo, preloadAjLogoWhite } from '../../workoutShare/logo';
import { preloadWorkoutShareGymArt } from '../../workoutShare/backgroundArt';
import { createWorkoutShareController, type WorkoutShareDestination } from '../../workoutShare/share';
import { copyWorkoutShareArtToClipboard } from '../../workoutShare/artClipboard';
import { saveWorkoutShareArtToLibrary } from '../../workoutShare/artSave';
import { logInfo, logWarn } from '../../lib/logger';
import type { WorkoutSummaryData } from '../../workoutSummary/buildWorkoutSummaryData';
import { WORKOUT_SHARE_POSTERS } from './posters/registry';
import type { WorkoutSharePhoto } from './posters/types';
import { WORKOUT_SHARE_ART_POSTERS } from './artPosters/registry';
import { ArtPreviewCheckerboard } from './ArtPreviewCheckerboard';
import { ShareToRow } from './ShareToRow';

type Photo = WorkoutSharePhoto;

type ShareMode = 'photo' | 'art';

type Props = {
  sex: Sex;
  data: WorkoutShareData;
  /**
   * The same object `WorkoutSummaryScreen` already computed just before
   * this composer mounts (`useWorkoutSummaryData`/`buildWorkoutSummaryData`
   * in `WorkoutScreen.tsx`) — volume/reps/personal-records for the ARTE
   * templates come from here, never recomputed.
   */
  summaryData: WorkoutSummaryData;
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

/** How long the "Arte copiada"/"PNG salvo" confirmation stays up before auto-dismissing. */
const MESSAGE_AUTO_DISMISS_MS = 3_000;

function IconAction({ label, icon, disabled, onPress }: {
  label: string;
  icon: 'camera' | 'plus' | 'swap' | 'copy' | 'download';
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

/** Tiny page indicator only — never a model preview. Tap still works, but swiping the poster itself is the primary way to switch designs. Shared by both the FOTO and ARTE carousels — `ids` is just whichever registry is currently in view. */
function PageDots({ ids, selectedIndex, onSelect }: { ids: readonly string[]; selectedIndex: number; onSelect: (index: number) => void }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 10 }}>
      {ids.map((id, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={id}
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

/**
 * FOTO/ARTE toggle — same two-option pill-row visual language
 * `PhotoVaultFilterBar` already uses elsewhere in the app (equal-width
 * bordered segments, filled + bright text when selected), just inlined here
 * since this is the only place in `workoutShare/` that needs it.
 */
function ModeSegmentedControl({ mode, onChange }: { mode: ShareMode; onChange: (mode: ShareMode) => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation('workout');
  const options: { id: ShareMode; label: string }[] = [
    { id: 'photo', label: t('done.shareComposer.modeSelector.photo') },
    { id: 'art', label: t('done.shareComposer.modeSelector.art') },
  ];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
      {options.map((option) => {
        const selected = mode === option.id;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
              backgroundColor: selected ? theme.colors.primarySoft : 'transparent',
            }}
          >
            <Text style={{ color: selected ? theme.colors.textPrimary : theme.colors.textFaint, fontFamily: theme.fonts.uiSemi, fontSize: 13, letterSpacing: 0.4 }}>
              {option.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function WorkoutShareComposer({ sex, data, summaryData, onDone }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation(['workout', 'common']);
  const scrollRef = useRef<ScrollView>(null);
  const artScrollRef = useRef<ScrollView>(null);
  const shareFlightRef = useRef(false);
  const artFlightRef = useRef(false);
  const messageDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useMemo(() => createWorkoutShareController(), []);
  const [mode, setMode] = useState<ShareMode>('photo');

  // Only `artPr` is ever conditional (needs >=1 personal record this
  // session) — filtered here once per `summaryData`, never inside render of
  // a single poster, so the carousel/page-dots/share-button math all agree
  // on the same list.
  const availableArtPosters = useMemo(
    () => WORKOUT_SHARE_ART_POSTERS.filter((poster) => isWorkoutShareArtLayoutAvailable(poster.id, summaryData)),
    [summaryData],
  );

  // One stable ref per layout — the carousel can have up to 3 pages mounted
  // at once (windowed rendering), so a single shared ref isn't enough; only
  // the currently selected layout's ref is ever read at share time.
  const posterRefs = useMemo(() => {
    const refs: Record<string, RefObject<View | null>> = {};
    for (const poster of WORKOUT_SHARE_POSTERS) refs[poster.id] = createRef<View>();
    return refs;
  }, []);

  // Same one-ref-per-layout rationale as `posterRefs`, scoped to whichever
  // ARTE designs this workout actually has (so a non-mounted `artPr` when
  // there's no PR never gets a dangling ref entry).
  const artPosterRefs = useMemo(() => {
    const refs: Record<string, RefObject<View | null>> = {};
    for (const poster of availableArtPosters) refs[poster.id] = createRef<View>();
    return refs;
  }, [availableArtPosters]);

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(DEFAULT_SELECTED_INDEX);
  const [selectedArtIndex, setSelectedArtIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessageState] = useState<string | null>(null);

  const selectedPoster = WORKOUT_SHARE_POSTERS[selectedIndex] ?? WORKOUT_SHARE_POSTERS[0];
  const selectedArtPoster = availableArtPosters[selectedArtIndex] ?? availableArtPosters[0];

  // The on-screen ARTE preview is deliberately small (fast to render while
  // swiping templates) — capturing it directly is exactly the upscale-blur
  // bug this stage exists to avoid (see `exportArt.ts`'s
  // `workoutShareArtRenderSize`). Instead, a single hidden instance of the
  // *selected* poster is mounted off-screen at full export resolution only
  // when an export is actually requested — never while just swiping — then
  // unmounted again once captured. `hdCacheRef` reuses the resulting PNG
  // across Copiar/Salvar/Compartilhar as long as neither the template nor
  // the underlying data has changed since it was generated.
  const hdPosterRef = useRef<View>(null);
  const [hdMountedPosterId, setHdMountedPosterId] = useState<string | null>(null);
  const hdLayoutResolveRef = useRef<(() => void) | null>(null);
  const hdCacheRef = useRef<{
    posterId: string;
    shareData: WorkoutShareData;
    summaryData: WorkoutSummaryData;
    uri: string;
  } | null>(null);

  const onHdPosterLayout = useCallback(() => {
    hdLayoutResolveRef.current?.();
    hdLayoutResolveRef.current = null;
  }, []);

  // Every `setMessage` call — not just the auto-dismissing ones — goes
  // through here, so a stale "clear after 3s" timer from a previous
  // Copiar/Salvar can never fire later and wipe out an unrelated message
  // (e.g. the user switches to FOTO mode and picks a photo within that
  // window). Any new message cancels whatever dismiss timer was pending.
  const setMessage = useCallback((text: string | null) => {
    if (messageDismissTimeoutRef.current) {
      clearTimeout(messageDismissTimeoutRef.current);
      messageDismissTimeoutRef.current = null;
    }
    setMessageState(text);
  }, []);

  // Shows the ARTE "Arte copiada" / "PNG salvo" confirmation and auto-clears
  // it after a few seconds — these two are terminal success toasts the user
  // never has to dismiss themselves, unlike the loading ("Gerando
  // imagem…") or error states, which stay until the next action replaces
  // them.
  const showAutoDismissingMessage = useCallback((text: string) => {
    setMessage(text);
    messageDismissTimeoutRef.current = setTimeout(() => {
      messageDismissTimeoutRef.current = null;
      setMessageState(null);
    }, MESSAGE_AUTO_DISMISS_MS);
  }, [setMessage]);

  useEffect(() => () => {
    if (messageDismissTimeoutRef.current) clearTimeout(messageDismissTimeoutRef.current);
  }, []);

  // Eagerly invalidates the cached HD export the moment the user switches
  // ARTE templates — the next `captureSelectedArt()` call would discard it
  // anyway (posterId mismatch), but doing it here means the stale temp file
  // doesn't linger on disk until the user happens to act again.
  useEffect(() => {
    const cached = hdCacheRef.current;
    if (cached && cached.posterId !== selectedArtPoster?.id) {
      discardWorkoutShareFile(cached.uri);
      hdCacheRef.current = null;
    }
  }, [selectedArtPoster?.id]);

  // Final safety net: whatever HD export is still cached when this composer
  // unmounts (closing the share flow without a follow-up action) is cleaned
  // up rather than left for the next `cleanupWorkoutShareFiles()` sweep.
  useEffect(() => () => {
    if (hdCacheRef.current) discardWorkoutShareFile(hdCacheRef.current.uri);
  }, []);

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

  const switchMode = useCallback((next: ShareMode) => {
    if (busy || mode === next) return;
    setMessage(null);
    setMode(next);
  }, [busy, mode]);

  // Captures the ARTE PNG at full export resolution, reusing it across
  // whichever of the three actions the user picked. On a cache hit (same
  // template, same underlying data) this does no rendering at all — it
  // just returns the already-generated file. On a miss, it mounts the
  // hidden HD stage for `selectedArtPoster`, waits for its first layout
  // pass (so the view actually has the full export size before capture —
  // otherwise this reproduces the exact upscale-blur bug it exists to
  // fix), captures it, and unmounts it again; the mounted stage is never
  // left sitting around between actions.
  const captureSelectedArt = useCallback(async () => {
    const poster = selectedArtPoster;
    const cached = hdCacheRef.current;
    if (cached && cached.posterId === poster.id && cached.shareData === data && cached.summaryData === summaryData) {
      logInfo('workout_share', 'workout_share_art_cache_hit', { layout: poster.id });
      return cached.uri;
    }
    if (cached) {
      discardWorkoutShareFile(cached.uri);
      hdCacheRef.current = null;
    }
    const layoutPromise = new Promise<void>((resolve) => {
      hdLayoutResolveRef.current = resolve;
    });
    setHdMountedPosterId(poster.id);
    await layoutPromise;
    try {
      const uri = await captureWorkoutShareArt(hdPosterRef, {
        width: poster.exportWidth,
        height: poster.exportHeight,
      });
      const pixelRatio = PixelRatio.get();
      let fileSize: number | null = null;
      try {
        fileSize = new File(uri).size ?? null;
      } catch {
        // Telemetry is best-effort — a failure to stat the file must never
        // fail the export itself.
      }
      logInfo('workout_share', 'workout_share_art_generated', {
        layout: poster.id,
        width: poster.exportWidth,
        height: poster.exportHeight,
        pixelRatio,
        exportScale: pixelRatio,
        fileSize,
      });
      hdCacheRef.current = { posterId: poster.id, shareData: data, summaryData, uri };
      return uri;
    } finally {
      setHdMountedPosterId(null);
    }
  }, [selectedArtPoster, data, summaryData]);

  const copyArt = useCallback(async () => {
    if (busy || artFlightRef.current) return;
    artFlightRef.current = true;
    setBusy(true);
    setMessage(t('done.shareComposer.generating'));
    try {
      const uri = await captureSelectedArt();
      const result = await copyWorkoutShareArtToClipboard(uri);
      if (result === 'copied') showAutoDismissingMessage(t('done.shareComposer.artCopied'));
      else if (result === 'unsupported') setMessage(t('done.shareComposer.artCopyUnsupported'));
      else setMessage(t('done.shareComposer.artCopyFailed'));
    } catch (error) {
      logWarn('workout_share', 'workout_share_art_copy_failed', { error });
      setMessage(t('done.shareComposer.artCopyFailed'));
    } finally {
      artFlightRef.current = false;
      setBusy(false);
    }
  }, [busy, captureSelectedArt, showAutoDismissingMessage, t]);

  const saveArt = useCallback(async () => {
    if (busy || artFlightRef.current) return;
    artFlightRef.current = true;
    setBusy(true);
    setMessage(t('done.shareComposer.generating'));
    try {
      const uri = await captureSelectedArt();
      const result = await saveWorkoutShareArtToLibrary(uri);
      if (result === 'saved') showAutoDismissingMessage(t('done.shareComposer.artSaved'));
      else if (result === 'permissionDenied') setMessage(t('done.shareComposer.permissionDenied'));
      else setMessage(t('done.shareComposer.artSaveFailed'));
    } catch (error) {
      logWarn('workout_share', 'workout_share_art_save_failed', { error });
      setMessage(t('done.shareComposer.artSaveFailed'));
    } finally {
      artFlightRef.current = false;
      setBusy(false);
    }
  }, [busy, captureSelectedArt, showAutoDismissingMessage, t]);

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

  const updateSelectedArtIndexFromOffset = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (previewWidth <= 0) return;
    const raw = event.nativeEvent.contentOffset.x / previewWidth;
    const index = Math.max(0, Math.min(availableArtPosters.length - 1, Math.round(raw)));
    setSelectedArtIndex((current) => (current === index ? current : index));
  }, [previewWidth, availableArtPosters.length]);

  const scrollToArtIndex = useCallback((index: number) => {
    artScrollRef.current?.scrollTo({ x: index * previewWidth, animated: true });
    setSelectedArtIndex(index);
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
            <ModeSegmentedControl mode={mode} onChange={switchMode} />

            {mode === 'photo' ? (
              <>
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

                <PageDots ids={WORKOUT_SHARE_POSTERS.map((poster) => poster.id)} selectedIndex={selectedIndex} onSelect={scrollToIndex} />

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
              </>
            ) : (
              <>
                {/* Same carousel shape as FOTO, but no photo, no change/remove
                    actions — and the checkerboard lives in the page wrapper
                    (a SIBLING of the poster's own ref'd View), never inside
                    the subtree `captureWorkoutShareArt` captures. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center' }}>
                    {selectedArtIndex > 0 ? (
                      <ModelNavArrow
                        direction="left"
                        label={t('done.shareComposer.previousModel')}
                        onPress={() => scrollToArtIndex(selectedArtIndex - 1)}
                      />
                    ) : null}
                  </View>

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
                        ref={artScrollRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={updateSelectedArtIndexFromOffset}
                        scrollEventThrottle={16}
                        style={{ borderRadius: 16 }}
                        testID="workout-share-art-carousel"
                      >
                        {availableArtPosters.map((poster, index) => {
                          const mounted = Math.abs(index - selectedArtIndex) <= 1;
                          const ArtPosterComponent = poster.Component;
                          return (
                            <View
                              key={poster.id}
                              style={{ width: previewWidth, height: previewHeight, borderRadius: 16, overflow: 'hidden' }}
                            >
                              <ArtPreviewCheckerboard width={previewWidth} height={previewHeight} />
                              {mounted ? (
                                <ArtPosterComponent
                                  shareData={data}
                                  summaryData={summaryData}
                                  width={previewWidth}
                                  height={previewHeight}
                                  posterRef={artPosterRefs[poster.id]}
                                />
                              ) : null}
                            </View>
                          );
                        })}
                      </ScrollView>
                    ) : null}
                  </View>

                  <View style={{ width: ARROW_SLOT_WIDTH, alignItems: 'center' }}>
                    {selectedArtIndex < availableArtPosters.length - 1 ? (
                      <ModelNavArrow
                        direction="right"
                        label={t('done.shareComposer.nextModel')}
                        onPress={() => scrollToArtIndex(selectedArtIndex + 1)}
                      />
                    ) : null}
                  </View>
                </View>

                <PageDots ids={availableArtPosters.map((poster) => poster.id)} selectedIndex={selectedArtIndex} onSelect={scrollToArtIndex} />

                <View style={{ marginTop: 18, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', gap: 22 }}>
                    <IconAction label={t('done.shareComposer.artActions.copy')} icon="copy" disabled={busy || previewWidth === 0} onPress={() => { void copyArt(); }} />
                    <IconAction label={t('done.shareComposer.artActions.save')} icon="download" disabled={busy || previewWidth === 0} onPress={() => { void saveArt(); }} />
                  </View>
                </View>

                {message ? (
                  <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary, textAlign: 'center', fontFamily: theme.fonts.uiMed, fontSize: 13, marginTop: 14 }}>
                    {message}
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>

          {/* Hidden HD export stage — mounted only while `captureSelectedArt`
              is actually generating a file (never while the user is just
              swiping templates). Looked up by id rather than reusing
              `selectedArtPoster` directly: the carousel isn't gated on
              `busy`, so the user could in principle swipe to a different
              template mid-capture, and this must keep rendering whichever
              poster was actually requested. Positioned far off-screen
              (never `opacity: 0` — some native capture paths render a
              view's *current* presentation state, and an invisible view
              would capture as blank) so it never flashes on screen while
              laid out at full export resolution. */}
          {hdMountedPosterId ? (() => {
            const hdPoster = WORKOUT_SHARE_ART_POSTERS.find((poster) => poster.id === hdMountedPosterId);
            if (!hdPoster) return null;
            const hdSize = workoutShareArtRenderSize(hdPoster.exportWidth, hdPoster.exportHeight);
            const HdPosterComponent = hdPoster.Component;
            return (
              <View
                pointerEvents="none"
                collapsable={false}
                onLayout={onHdPosterLayout}
                style={{ position: 'absolute', left: -100000, top: 0, width: hdSize.width, height: hdSize.height }}
              >
                <HdPosterComponent
                  shareData={data}
                  summaryData={summaryData}
                  width={hdSize.width}
                  height={hdSize.height}
                  posterRef={hdPosterRef}
                />
              </View>
            );
          })() : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
