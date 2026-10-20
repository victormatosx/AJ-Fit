import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AddPhotoSheet, type PickedPhoto } from '../components/photoVault/AddPhotoSheet';
import { PhotoVaultEmptyState } from '../components/photoVault/PhotoVaultEmptyState';
import { PhotoVaultFilterEmptyState } from '../components/photoVault/PhotoVaultFilterEmptyState';
import { PhotoVaultGrid } from '../components/photoVault/PhotoVaultGrid';
import { PhotoVaultLockedState } from '../components/photoVault/PhotoVaultLockedState';
import { PhotoVaultViewer } from '../components/photoVault/PhotoVaultViewer';
import { PhotoCompareScreen } from '../components/photoVault/PhotoCompareScreen';
import { canCompareProgressPhotos } from '../lib/photoVaultCompare';
import {
  filterProgressDays,
  flattenProgressDayPhotos,
  groupProgressPhotosByDay,
  type ProgressPhotoFilter,
} from '../lib/photoVaultDayGrouping';
import { PhotoVaultFilterBar } from '../components/photoVault/PhotoVaultFilterBar';
import { localDateKey, type ProgressPhotoPose } from '../lib/photoVaultIdentity';
import { Icon } from '../components/ui/Icon';
import {
  addGalleryPhoto,
  claimGalleryThumbnail,
  claimGalleryPhotoForViewer,
  replaceGalleryPhoto,
  discardGalleryPreview,
  isSlotTaken,
  getGalleryState,
  loadGallery,
  markGalleryPhotoRendered,
  markViewerPhotoRendered,
  releaseGalleryThumbnail,
  releaseGalleryPhotoFromViewer,
  removeGalleryPhoto,
  retryGalleryPhoto,
  subscribeToGallery,
  type GalleryState,
} from '../lib/photoVaultGallery';
import type { PhotoVaultIssue } from '../lib/photoVaultErrors';
import { shouldShowPhotoVaultLocked } from '../lib/photoVaultLockedVisibility';
import { tracePhotoVault } from '../lib/photoVaultDevTrace';
import {
  pickPhotoFromLibrary,
  takePhotoWithCamera,
  type PickerOutcome,
} from '../services/photoVaultPicker';
import { usePhotoVault } from '../state/PhotoVaultContext';
import { useAuth } from '../state/AuthContext';
import { getReauthenticationProviders, type ReauthenticationProvider } from '../lib/authProviders';
import { reauthenticateAndRecoverVaultKey } from '../services/photoVaultRecovery';
import { ReauthenticationMethods } from '../components/auth/ReauthenticationMethods';
import { usePremiumAction } from '../state/PremiumActionContext';
import { PremiumAction } from '../components/premium/PremiumAction';
import { useTheme } from '../theme';

/**
 * The private photos area.
 *
 * Orchestration only: unlocking goes through `PhotoVaultContext`, data goes
 * through `photoVaultGallery`, and picking goes through
 * `photoVaultPicker`. This screen never touches Firebase, the vault key or
 * any crypto primitive, and it never renders anything about the encryption
 * itself — for the user this is simply "private photos".
 */

interface ProgressPhotosScreenProps {
  /** Existing Progress page chrome, kept inside the same virtualized scroller. */
  pageHeader?: ReactNode;
  pageFooter?: ReactNode;
}

export function ProgressPhotosScreen({
  pageHeader = null,
  pageFooter = null,
}: ProgressPhotosScreenProps = {}) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const {
    status,
    lastIssue,
    unlock,
    setHasPhotoVaultContent,
  } = usePhotoVault();
  const { logout, user } = useAuth();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordVisible, setRecoveryPasswordVisible] = useState(false);
  const [recoveryProvider, setRecoveryProvider] = useState<ReauthenticationProvider | null>(null);
  const [recoveryError, setRecoveryError] = useState(false);
  const recoveryProviders = useMemo(() => getReauthenticationProviders(user), [user]);
  const recoverVault = useCallback(async (provider: ReauthenticationProvider) => {
    if (provider === 'password' && !recoveryPassword) return;
    setRecoveryProvider(provider);
    setRecoveryError(false);
    try {
      await reauthenticateAndRecoverVaultKey(provider === 'password' ? { provider, password: recoveryPassword } : { provider });
      setRecoveryOpen(false);
      setRecoveryPassword('');
      await loadGallery();
    } catch {
      setRecoveryError(true);
    } finally {
      setRecoveryProvider(null);
    }
  }, [loadGallery, recoveryPassword]);
  // FASE 5: the primary "add photo" CTA (footer button) is wrapped in
  // <PremiumAction> below, which derives its own `locked` display state —
  // no `canPerform` needed directly in this screen anymore for that.
  // `requestPremiumAction` (imperative) stays for confirmDelete (Fase 5
  // §11: excluir foto happens inside a viewer/menu, not a natural fit for
  // the declarative wrapper) and for the secondary "add" entry points
  // (empty states, grid slots) that converge on the same protected
  // `openSheet` handler instead of each mounting their own <PremiumAction>.
  const { requestPremiumAction } = usePremiumAction();

  const [gallery, setGallery] = useState<GalleryState>(getGalleryState);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Pre-selected pose when the flow was opened from an empty slot. */
  const [sheetPose, setSheetPose] = useState<ProgressPhotoPose | undefined>(undefined);
  /**
   * Which poses the gallery shows. Local presentation state only — never
   * persisted, and it holds no private content, so it survives a lock
   * harmlessly while the photos themselves are revoked by the controller.
   */
  const [filter, setFilter] = useState<ProgressPhotoFilter>('all');
  /**
   * The comparator owns its own selection; this only says whether it is
   * open. Closing it (including when the vault locks, below) discards that
   * selection with the unmount.
   */
  const [compareOpen, setCompareOpen] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => subscribeToGallery(setGallery), []);

  useEffect(() => {
    tracePhotoVault('viewerDismiss.reactStateChanged', { viewerOpen: viewerId !== null });
  }, [viewerId]);

  // The session's lifetime is NOT this panel's mount — `ProgressScreen` owns
  // it for as long as Evolution is the active screen, so switching to
  // Corpo/Cargas and back lands straight on the open gallery instead of
  // re-opening the vault and reloading from scratch each time. Leaving
  // Evolution altogether (or backgrounding the app) still revokes the
  // session, removes its plaintext and releases the native capture guard.

  const unlocked = status === 'unlocked';
  /**
   * Extends the locked view a little further after a real unlock, so
   * `PhotoVaultLockedState` has time to finish its reveal animation before
   * the real gallery mounts. `shouldShowPhotoVaultLocked` below is what
   * actually gates the branch — `unlocked` alone decides the moment the
   * vault re-locks, this state can only ever prolong "locked", never
   * shorten it. See `lib/photoVaultLockedVisibility.ts`.
   */
  const [showLocked, setShowLocked] = useState(!unlocked);

  useEffect(() => {
    if (!unlocked) setShowLocked(true);
  }, [unlocked]);

  /**
   * A cancellation is not a failure the user should see: it only means the
   * app left the foreground while the session was opening, and the effect
   * below reopens it on return. Everything else is a genuine technical
   * problem (temp files that could not be cleared, the native app-switcher
   * guard refusing to install) and does get a retry control.
   */
  const openFailure =
    lastIssue !== null && lastIssue !== 'vaultAuthCancelled' ? lastIssue : null;

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setAppActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);

  /**
   * Opens the gallery directly — no biometrics, passcode or unlock screen.
   *
   * Gated on the app being foregrounded for two reasons: the session must
   * never open behind an app-switcher preview, and `unlockPhotoVault` would
   * otherwise fail with a cancellation it could not recover from on its own.
   * Returning to the foreground is therefore also what reopens a session the
   * lifecycle closed. `openFailure` stops a real failure from retrying in a
   * loop; tapping retry clears it and resumes.
   */
  useEffect(() => {
    if (!appActive || status !== 'locked' || openFailure) return;
    void unlock();
  }, [appActive, status, openFailure, unlock]);

  // Temporary trace. Kept in an effect of its own so the lifecycle rule
  // above — load on unlock — keeps its exact shape.
  useEffect(() => {
    tracePhotoVault('screen.photos.mount');
    return () => tracePhotoVault('screen.photos.unmount');
  }, []);

  useEffect(() => {
    tracePhotoVault('screen.photos.vaultStatus', { status, unlocked });
  }, [status, unlocked]);

  // Load once the vault opens. Locking is handled by the gallery module,
  // which discards every decrypted file on its own.
  useEffect(() => {
    if (unlocked) void loadGallery();
  }, [unlocked]);

  // A locked vault has no viewer: the file behind it is already gone.
  useEffect(() => {
    if (!unlocked) {
      releaseGalleryPhotoFromViewer(viewerId);
      setViewerId(null);
      setSheetOpen(false);
      setCompareOpen(false);
    }
  }, [unlocked, viewerId]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    [],
  );
  const formatDate = useCallback(
    (date: Date) => dateFormatter.format(date),
    [dateFormatter],
  );

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
    [],
  );
  const formatMonth = useCallback(
    (date: Date) => monthFormatter.format(date),
    [monthFormatter],
  );

  // Derived projection, never persisted. Memoized on the photos array
  // reference: the controller replaces it on every emit, so this recomputes
  // exactly when the gallery actually changed and not on unrelated renders.
  const days = useMemo(
    () => groupProgressPhotosByDay(gallery.photos),
    [gallery.photos],
  );

  // Narrowing is a second derived pass over the same in-memory projection:
  // switching filters never refetches, redownloads or decrypts anything.
  const visibleDays = useMemo(() => filterProgressDays(days, filter), [days, filter]);

  // "No photos at all" and "no photos of this pose" are different situations
  // and must not share an empty state.
  const galleryEmpty = gallery.photos.length === 0;
  // Not `length >= 2`: one front and one side is two photos and zero valid
  // pairs, so the entry point would open onto a dead end.
  const canCompare = useMemo(
    () => canCompareProgressPhotos(gallery.photos),
    [gallery.photos],
  );
  const filterEmpty = !galleryEmpty && visibleDays.length === 0;

  /**
   * Whether the pinned action bar is worth the space it takes.
   *
   * Hidden while the gallery is loading, empty, or narrowed to a pose with no
   * photos: each of those states already renders its own "add" call to action,
   * and a second one would be the same offer twice on one screen.
   */
  const showActionBar = gallery.status === 'ready' && !galleryEmpty && !filterEmpty;

  // The swipe sequence IS what the grid shows: derived from the same filtered
  // days, so a pose filter narrows it and `all` spans the whole gallery.
  const viewerPhotos = useMemo(() => flattenProgressDayPhotos(visibleDays), [visibleDays]);

  const viewerPhoto = viewerId
    ? (gallery.photos.find((p) => p.photoId === viewerId) ?? null)
    : null;

  // The viewer closes itself if every temporary representation disappears.
  useEffect(() => {
    if (
      viewerId &&
      (!viewerPhoto ||
        (!viewerPhoto.fullUri && !viewerPhoto.thumbnailUri && !viewerPhoto.previewUri))
    ) {
      releaseGalleryPhotoFromViewer(viewerId);
      setViewerId(null);
    }
  }, [viewerId, viewerPhoto]);

  /**
   * The two photos one swipe away, in the order the grid actually paints.
   *
   * Derived from `viewerPhotos` rather than from the whole gallery, so a pose
   * filter narrows the prefetch window exactly as it narrows the carousel. The
   * gallery controller is told which ids these are instead of an index range:
   * it has no view of the filter, and guessing "next" there would be a second
   * definition of order to keep in step with this one.
   */
  const neighboursOf = useCallback(
    (photoId: string) => {
      const index = viewerPhotos.findIndex((entry) => entry.photoId === photoId);
      if (index < 0) return {};
      return {
        previous: viewerPhotos[index - 1]?.photoId ?? null,
        next: viewerPhotos[index + 1]?.photoId ?? null,
      };
    },
    [viewerPhotos],
  );

  const handleOpenViewer = useCallback(
    (photoId: string) => {
      claimGalleryPhotoForViewer(photoId, neighboursOf(photoId));
      setViewerId(photoId);
    },
    [neighboursOf],
  );

  /**
   * Paging moved to another photo.
   *
   * The claim moves with it, one photo at a time: releasing the previous one
   * first is what stops a swiped-past decrypt from landing (and from keeping
   * its plaintext). The new claim carries the recomputed window, so the photo
   * the user just left becomes a prefetched neighbour — which is what makes
   * swiping back free — and anything that fell outside is abandoned.
   */
  const handleNavigateViewer = useCallback(
    (nextPhotoId: string) => {
      setViewerId((current) => {
        if (current === nextPhotoId) return current;
        releaseGalleryPhotoFromViewer(current);
        claimGalleryPhotoForViewer(nextPhotoId, neighboursOf(nextPhotoId));
        return nextPhotoId;
      });
    },
    [neighboursOf],
  );

  /**
   * Asks the durable queue to deliver this photo again, now.
   *
   * Not a re-upload from scratch: the ciphertext is already on the device and
   * whatever the job already placed remotely is kept, so this only clears the
   * backoff and wakes the worker.
   */
  const handleRetrySync = useCallback((photoId: string) => {
    setNotice(null);
    void retryGalleryPhoto(photoId);
  }, []);

  const handleCloseViewer = useCallback(() => {
    tracePhotoVault('viewerDismiss.parentOnCloseCalled');
    setViewerId((current) => {
      releaseGalleryPhotoFromViewer(current);
      return null;
    });
  }, []);

  const uploadErrorMessage = useCallback(
    (issue: PhotoVaultIssue | null): string => {
      switch (issue) {
        case 'vaultPhotoTooLarge':
          return t('progress.photos.uploadError.tooLarge');
        case 'vaultPhotoSlotTaken':
          return t('progress.photos.uploadError.slotTaken');
        case 'vaultUploadFailed':
        case 'vaultDownloadFailed':
        case 'vaultListFailed':
          return t('progress.photos.uploadError.network');
        default:
          return t('progress.photos.uploadError.generic');
      }
    },
    [t],
  );

  /** Picker outcomes the sheet cannot act on become a visible notice. */
  /** Replacement failures need their own copy: the old photo usually survives. */
  const replaceErrorMessage = useCallback(
    (issue: PhotoVaultIssue | null): string => {
      switch (issue) {
        case 'vaultReplaceSlotChanged':
          return t('progress.photos.replace.slotChanged');
        case 'vaultReplaceRestoreFailed':
          return t('progress.photos.replace.restoreFailed');
        case 'vaultReplaceSlotMissing':
          return t('progress.photos.replace.slotMissing');
        default:
          return t('progress.photos.replace.failed');
      }
    },
    [t],
  );

  const handlePickerIssue = useCallback(
    (outcome: PickerOutcome) => {
      switch (outcome.status) {
        case 'permissionDenied':
          setNotice(t('progress.photos.permission.libraryDenied'));
          return;
        case 'unsupported':
          setNotice(t('progress.photos.uploadError.unsupported'));
          return;
        default:
          setNotice(t('progress.photos.uploadError.generic'));
      }
    },
    [t],
  );

  const handleCamera = useCallback(async () => {
    const outcome = await takePhotoWithCamera();
    if (outcome.status === 'permissionDenied') {
      setNotice(t('progress.photos.permission.cameraDenied'));
    }
    return outcome;
  }, [t]);

  const handleLibrary = useCallback(() => pickPhotoFromLibrary(), []);

  /**
   * Saves one pose through the controller.
   *
   * Called once per filled draft — concurrently, since the three poses are
   * committed together — so a failure is reported for that pose alone and
   * never cancels a sibling that already succeeded. Only the pose and the
   * picked image cross this boundary — the day, the document id, the asset id
   * and both Storage paths are derived by the service, so a photo can never be
   * filed under a day it did not happen.
   *
   * The issue comes back WITH the result rather than being read from the
   * controller's shared `issue` slot afterwards: with three poses in flight,
   * that slot holds whichever failed last, not this one.
   */
  const handleSavePose = useCallback(
    async (photo: PickedPhoto, pose: ProgressPhotoPose) => {
      setNotice(null);
      const result = await addGalleryPhoto({
        sourceUri: photo.sourceUri,
        takenAt: photo.takenAt,
        originalMimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        pose,
      });
      if (result.ok) return { ok: true };
      setNotice(uploadErrorMessage(result.issue ?? null));
      return { ok: false, issue: result.issue };
    },
    [uploadErrorMessage],
  );

  /**
   * Swaps the photo already occupying a slot.
   *
   * Finds the existing photo by (day, pose) from the same in-memory metadata
   * the slot check uses, so the UI never supplies an identity of its own.
   */
  const handleReplacePose = useCallback(
    async (photo: PickedPhoto, pose: ProgressPhotoPose) => {
      setNotice(null);
      const dateKey = localDateKey(photo.takenAt);
      const existing = getGalleryState().photos.find(
        (entry) => entry.dateKey === dateKey && entry.pose === pose,
      );
      if (!existing) {
        // The slot emptied underneath: fall back to a plain create.
        return handleSavePose(photo, pose);
      }
      const result = await replaceGalleryPhoto(existing.photoId, {
        sourceUri: photo.sourceUri,
        takenAt: photo.takenAt,
        originalMimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        pose,
      });
      if (result.ok) return { ok: true };
      setNotice(replaceErrorMessage(result.issue ?? null));
      return { ok: false, issue: result.issue };
    },
    [handleSavePose, replaceErrorMessage],
  );

  // FASE 3→5 (docs/13_assinaturas_e_billing.md): ADD_PROGRESS_PHOTO is a
  // Premium capability. Reading the gallery stays free — only starting a
  // new upload is gated, never the screen mount.
  //
  // `openSheetUnguarded` is the actual state change, with no capability
  // knowledge at all — it's what `<PremiumAction>` calls as `onAllowed` for
  // the primary CTA (see the footer button below). `openSheet` wraps the
  // exact same `requestPremiumAction` call for the secondary entry points
  // (empty states, grid slots — see FASE 3 report §"Entry points
  // secundários de foto" for why those stay imperative instead of each
  // mounting their own `<PremiumAction>`), so every path funnels through
  // one authorization call either way.
  const openSheetUnguarded = useCallback((pose?: ProgressPhotoPose) => {
    tracePhotoVault('screen.sheet.open', { pose: pose ?? 'none' });
    setSheetPose(pose);
    setSheetOpen(true);
  }, []);

  const openSheet = useCallback(
    (pose?: ProgressPhotoPose) => {
      requestPremiumAction({
        capability: 'ADD_PROGRESS_PHOTO',
        onAllowed: () => openSheetUnguarded(pose),
      });
    },
    [requestPremiumAction, openSheetUnguarded],
  );

  const confirmDelete = useCallback(
    (photoId: string) => {
      // DELETE_PROGRESS_PHOTO — same rationale as openSheet above; blocked
      // before the native confirm dialog even opens.
      requestPremiumAction({
        capability: 'DELETE_PROGRESS_PHOTO',
        onAllowed: () => {
          Alert.alert(
            t('progress.photos.delete.title'),
            t('progress.photos.delete.description'),
            [
              { text: t('progress.photos.delete.cancel'), style: 'cancel' },
              {
                text: t('progress.photos.delete.confirm'),
                style: 'destructive',
                onPress: () => {
                  handleCloseViewer();
                  void (async () => {
                    const ok = await removeGalleryPhoto(photoId);
                    if (!ok) {
                      setNotice(t('progress.photos.delete.error'));
                      return;
                    }
                    // The delete is now confirmed remotely. Only the transition
                    // to a truly empty authoritative gallery clears the hint.
                    if (getGalleryState().photos.length === 0) {
                      await setHasPhotoVaultContent(false);
                    }
                  })();
                },
              },
            ],
          );
        },
      });
    },
    [requestPremiumAction, handleCloseViewer, setHasPhotoVaultContent, t],
  );

  // ── Locked ───────────────────────────────────────────────────────────────
  // Nothing about the vault's contents is rendered before this point.
  // `shouldShowPhotoVaultLocked` gates strictly on `unlocked`: the moment the
  // vault is not unlocked, this branch is taken, full stop. `showLocked` can
  // only extend it further, to let a successful unlock's reveal animation
  // finish before the real gallery below ever mounts.
  if (shouldShowPhotoVaultLocked(unlocked, showLocked)) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {pageHeader}
        <PhotoVaultLockedState
          status={status}
          issue={openFailure}
          onUnlock={() => void unlock()}
          onRevealComplete={() => setShowLocked(false)}
        />
        {pageFooter}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* The grid takes whatever the action bar leaves. A flex sibling rather
          than an absolute overlay: the bar is opaque and always visible, so
          nothing must be able to scroll underneath and hide behind it. */}
      <View style={{ flex: 1 }}>
      <PhotoVaultGrid
        days={gallery.status === 'ready' ? visibleDays : []}
        filter={filter}
        onVisible={claimGalleryThumbnail}
        onHidden={releaseGalleryThumbnail}
        onOpen={handleOpenViewer}
        onAddPose={openSheet}
        onRendered={markGalleryPhotoRendered}
        onRetrySync={handleRetrySync}
        formatDate={formatDate}
        formatMonth={formatMonth}
        listHeader={(
          <>
            {pageHeader}
            {gallery.status === 'ready' && !galleryEmpty ? (
              <PhotoVaultFilterBar value={filter} onChange={setFilter} />
            ) : null}
            {notice ? (
              <View style={{ paddingHorizontal: 22, paddingBottom: 14 }}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    color: theme.colors.textMuted,
                    fontFamily: theme.fonts.ui,
                    fontSize: 13,
                    lineHeight: 19,
                  }}
                >
                  {notice}
                </Text>
              </View>
            ) : null}

            {gallery.status === 'loading' ? (
              <View style={{ paddingVertical: 56, alignItems: 'center', gap: 14 }}>
                <ActivityIndicator color={theme.colors.textFaint} />
                <Text
                  style={{
                    color: theme.colors.textFaint,
                    fontFamily: theme.fonts.mono,
                    fontSize: 10,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('progress.photos.list.loading')}
                </Text>
              </View>
            ) : gallery.status === 'error' ? (
              <View style={{ paddingVertical: 56, alignItems: 'center', gap: 14 }}>
                <Text
                  style={{
                    color: theme.colors.textMuted,
                    fontFamily: theme.fonts.ui,
                    fontSize: 14,
                    textAlign: 'center',
                    paddingHorizontal: 22,
                  }}
                >
                  {gallery.issue === 'vaultReauthRequired'
                    ? t('progress.photos.list.reauthRequired')
                    : t('progress.photos.list.error')}
                </Text>
                {gallery.issue === 'vaultReauthRequired' ? (
                  <>
                    <Pressable
                      onPress={() => {
                        setRecoveryError(false);
                        setRecoveryOpen(true);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('progress.photos.list.confirmIdentity')}
                      style={{ paddingVertical: 10, paddingHorizontal: 18 }}
                    >
                      <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>
                        {t('progress.photos.list.confirmIdentity')}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => void logout()} accessibilityRole="button" style={{ paddingVertical: 6 }}>
                      <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 12 }}>
                        {t('progress.photos.list.signOut')}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {gallery.issue !== 'vaultReauthRequired' ? (
                  <Pressable
                    onPress={() => void loadGallery()}
                    accessibilityRole="button"
                    accessibilityLabel={t('progress.photos.list.retry')}
                    style={{ paddingVertical: 10, paddingHorizontal: 18 }}
                  >
                    <Text style={{ color: theme.colors.primaryEmphasis, fontFamily: theme.fonts.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>
                      {t('progress.photos.list.retry')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : galleryEmpty ? (
              <PhotoVaultEmptyState onAdd={() => openSheet()} />
            ) : filterEmpty && filter !== 'all' ? (
              <PhotoVaultFilterEmptyState pose={filter} onAdd={() => openSheet(filter)} />
            ) : null}
          </>
        )}
        listFooter={<>{pageFooter}</>}
      />
      </View>

      {/*
        The two gallery-wide actions, pinned above the grid.

        Both used to live inside the list — "add" at the very bottom of the
        footer and "compare" up in the header — so reaching either meant
        scrolling to opposite ends of the gallery. Pinning them puts the two
        things the user came here to do within reach at any scroll position,
        with "add" on top because it is the primary one.
      */}
      {showActionBar ? (
        <View
          testID="photo-vault-action-bar"
          style={{
            paddingHorizontal: 22,
            paddingTop: 12,
            paddingBottom: 12,
            gap: 10,
            backgroundColor: theme.colors.background,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {/* FASE 5: the primary "add" CTA — single discreet lock indicator
              (empty states keep their plain "+" icon, per Fase 3's "não
              espalhe cadeados" decision), sourced from <PremiumAction>
              instead of a local canPerform() read. */}
          <PremiumAction capability="ADD_PROGRESS_PHOTO" onAllowed={openSheetUnguarded}>
            {({ locked, onPress }) => (
              <Pressable
                onPress={onPress}
                disabled={gallery.uploading}
                accessibilityRole="button"
                accessibilityLabel={
                  locked
                    ? t('progress.photos.a11y.addPhotoLocked')
                    : t('progress.photos.a11y.addPhoto')
                }
                accessibilityState={{ disabled: gallery.uploading }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  paddingVertical: 15,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  opacity: gallery.uploading ? 0.4 : 1,
                }}
              >
                <Icon name={locked ? 'lock' : 'plus'} size={14} color={theme.colors.primaryEmphasis} />
                <Text
                  style={{
                    color: theme.colors.textPrimary,
                    fontFamily: theme.fonts.mono,
                    fontSize: 10,
                    letterSpacing: 2,
                    textTransform: 'uppercase',
                  }}
                >
                  {t('progress.photos.list.add')}
                </Text>
              </Pressable>
            )}
          </PremiumAction>

          {/* Only once there is actually a valid pair to compare — otherwise
              the entry point opens onto a dead end. */}
          {canCompare ? (
            <Pressable
              onPress={() => setCompareOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('progress.photos.a11y.openCompare')}
              testID="photo-vault-compare-cta"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                paddingVertical: 13,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Icon name="swap" size={14} color={theme.colors.primaryEmphasis} />
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  fontFamily: theme.fonts.mono,
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                }}
              >
                {t('progress.photos.compare.cta')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <AddPhotoSheet
        visible={sheetOpen}
        initialPose={sheetPose}
        onClose={() => setSheetOpen(false)}
        onPickCamera={handleCamera}
        onPickLibrary={handleLibrary}
        onPickerIssue={handlePickerIssue}
        onDiscard={discardGalleryPreview}
        onSavePose={handleSavePose}
        isSlotTaken={isSlotTaken}
        onReplacePose={handleReplacePose}
        formatDate={formatDate}
      />

      <PhotoCompareScreen
        visible={compareOpen}
        photos={gallery.photos}
        onVisible={claimGalleryThumbnail}
        onHidden={releaseGalleryThumbnail}
        onClose={() => setCompareOpen(false)}
        formatDate={formatDate}
      />

      <Modal visible={recoveryOpen} transparent animationType="slide" onRequestClose={() => setRecoveryOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <View style={{ padding: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: theme.colors.background }}>
            <Text style={{ color: theme.colors.textPrimary, fontFamily: theme.fonts.display, fontSize: 22 }}>
              {t('progress.photos.list.reauthTitle')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 18 }}>
              {t('progress.photos.list.reauthBody')}
            </Text>
            {recoveryError ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.feedbackErrorText, fontFamily: theme.fonts.ui, fontSize: 13, marginBottom: 12 }}>{t('progress.photos.list.reauthError')}</Text> : null}
            <ReauthenticationMethods
              providers={recoveryProviders}
              password={recoveryPassword}
              passwordVisible={recoveryPasswordVisible}
              busyProvider={recoveryProvider}
              disabled={recoveryProvider !== null}
              onChangePassword={setRecoveryPassword}
              onTogglePassword={() => setRecoveryPasswordVisible((value) => !value)}
              onConfirm={(provider) => void recoverVault(provider)}
            />
            <Pressable onPress={() => setRecoveryOpen(false)} disabled={recoveryProvider !== null} style={{ paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: theme.colors.textMuted, fontFamily: theme.fonts.uiMed, fontSize: 13 }}>{t('progress.photos.list.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <PhotoVaultViewer
        photos={viewerPhotos}
        photoId={viewerId}
        formatDate={formatDate}
        onClose={handleCloseViewer}
        onDelete={confirmDelete}
        onRendered={markViewerPhotoRendered}
        onNavigate={handleNavigateViewer}
        deleting={gallery.deletingId !== null}
      />
    </View>
  );
}
