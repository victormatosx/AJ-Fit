import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
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
  subscribeToGallery,
  type GalleryState,
} from '../lib/photoVaultGallery';
import type { PhotoVaultIssue } from '../lib/photoVaultErrors';
import {
  pickPhotoFromLibrary,
  takePhotoWithCamera,
  type PickerOutcome,
} from '../services/photoVaultPicker';
import { usePhotoVault } from '../state/PhotoVaultContext';
import { colors, fonts } from '../theme/tokens';

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
  const {
    status,
    lastIssue,
    hasPhotoVaultContent,
    hasPhotoVaultContentReady,
    unlock,
    lock,
    setHasPhotoVaultContent,
  } = usePhotoVault();

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

  // Screen capture protection is scoped to the private area. Leaving the
  // Photo Vault revokes the session, removes its plaintext and lets the
  // provider release the native guard after the safe locked frame renders.
  useEffect(() => () => lock(), [lock]);

  const unlocked = status === 'unlocked';

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

  const handleOpenViewer = useCallback((photoId: string) => {
    claimGalleryPhotoForViewer(photoId);
    setViewerId(photoId);
  }, []);

  const handleCloseViewer = useCallback(() => {
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
   * Called once per filled draft, so a failure is reported for that pose
   * alone and never cancels a sibling that already succeeded. Only the pose
   * and the picked image cross this boundary — the day, the document id, the
   * asset id and both Storage paths are derived by the service, so a photo can
   * never be filed under a day it did not happen.
   */
  const handleSavePose = useCallback(
    async (photo: PickedPhoto, pose: ProgressPhotoPose) => {
      setNotice(null);
      const ok = await addGalleryPhoto({
        sourceUri: photo.sourceUri,
        takenAt: photo.takenAt,
        originalMimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        pose,
      });
      if (ok) return { ok: true };
      // Read straight after the awaited call: uploads run one at a time, so
      // this issue belongs to the pose that just failed.
      const issue = getGalleryState().issue;
      setNotice(uploadErrorMessage(issue));
      return { ok: false, issue: issue ?? undefined };
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
      const ok = await replaceGalleryPhoto(existing.photoId, {
        sourceUri: photo.sourceUri,
        takenAt: photo.takenAt,
        originalMimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        pose,
      });
      if (ok) return { ok: true };
      const issue = getGalleryState().issue;
      setNotice(replaceErrorMessage(issue));
      return { ok: false, issue: issue ?? undefined };
    },
    [handleSavePose, replaceErrorMessage],
  );

  const openSheet = useCallback((pose?: ProgressPhotoPose) => {
    setSheetPose(pose);
    setSheetOpen(true);
  }, []);

  const confirmDelete = useCallback(
    (photoId: string) => {
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
    [handleCloseViewer, setHasPhotoVaultContent, t],
  );

  // ── Locked ───────────────────────────────────────────────────────────────
  // Nothing about the vault's contents is rendered before this point.
  if (!unlocked) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {pageHeader}
        <PhotoVaultLockedState
          status={status === 'authenticating' ? 'authenticating' : 'locked'}
          issue={lastIssue}
          hasContent={hasPhotoVaultContent}
          contentPresenceReady={hasPhotoVaultContentReady}
          onUnlock={() => void unlock()}
        />
        {pageFooter}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PhotoVaultGrid
        days={gallery.status === 'ready' ? visibleDays : []}
        filter={filter}
        onVisible={claimGalleryThumbnail}
        onHidden={releaseGalleryThumbnail}
        onOpen={handleOpenViewer}
        onAddPose={openSheet}
        onRendered={markGalleryPhotoRendered}
        formatDate={formatDate}
        formatMonth={formatMonth}
        listHeader={(
          <>
            {pageHeader}
            {gallery.status === 'ready' && !galleryEmpty ? (
              <>
                <PhotoVaultFilterBar value={filter} onChange={setFilter} />
                {canCompare ? (
                  <View style={{ paddingHorizontal: 22, paddingBottom: 14 }}>
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
                        borderColor: colors.border,
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Icon name="swap" size={14} color={colors.accentHi} />
                      <Text
                        style={{
                          color: colors.text,
                          fontFamily: fonts.mono,
                          fontSize: 10,
                          letterSpacing: 2,
                          textTransform: 'uppercase',
                        }}
                      >
                        {t('progress.photos.compare.cta')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
            {notice ? (
              <View style={{ paddingHorizontal: 22, paddingBottom: 14 }}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    color: colors.mute,
                    fontFamily: fonts.ui,
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
                <ActivityIndicator color={colors.faint} />
                <Text
                  style={{
                    color: colors.faint,
                    fontFamily: fonts.mono,
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
                    color: colors.mute,
                    fontFamily: fonts.ui,
                    fontSize: 14,
                    textAlign: 'center',
                    paddingHorizontal: 22,
                  }}
                >
                  {t('progress.photos.list.error')}
                </Text>
                <Pressable
                  onPress={() => void loadGallery()}
                  accessibilityRole="button"
                  accessibilityLabel={t('progress.photos.list.retry')}
                  style={{ paddingVertical: 10, paddingHorizontal: 18 }}
                >
                  <Text
                    style={{
                      color: colors.accentHi,
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('progress.photos.list.retry')}
                  </Text>
                </Pressable>
              </View>
            ) : galleryEmpty ? (
              <PhotoVaultEmptyState onAdd={() => openSheet()} />
            ) : filterEmpty && filter !== 'all' ? (
              <PhotoVaultFilterEmptyState pose={filter} onAdd={() => openSheet(filter)} />
            ) : null}
          </>
        )}
        listFooter={(
          <>
            {gallery.status === 'ready' && !galleryEmpty && !filterEmpty ? (
              <View style={{ paddingHorizontal: 22, paddingTop: 14 }}>
                <Pressable
                  onPress={() => openSheet()}
                  disabled={gallery.uploading}
                  accessibilityRole="button"
                  accessibilityLabel={t('progress.photos.a11y.addPhoto')}
                  accessibilityState={{ disabled: gallery.uploading }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    paddingVertical: 15,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    opacity: gallery.uploading ? 0.4 : 1,
                  }}
                >
                  <Icon name="plus" size={14} color={colors.accentHi} />
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('progress.photos.list.add')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {pageFooter}
          </>
        )}
      />

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

      <PhotoVaultViewer
        photo={viewerPhoto}
        formatDate={formatDate}
        onClose={handleCloseViewer}
        onDelete={confirmDelete}
        onRendered={markViewerPhotoRendered}
        deleting={gallery.deletingId !== null}
      />
    </View>
  );
}
