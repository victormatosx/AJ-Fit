import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AddPhotoSheet } from '../components/photoVault/AddPhotoSheet';
import { PhotoVaultEmptyState } from '../components/photoVault/PhotoVaultEmptyState';
import { PhotoVaultGrid } from '../components/photoVault/PhotoVaultGrid';
import { PhotoVaultLockedState } from '../components/photoVault/PhotoVaultLockedState';
import { PhotoVaultViewer } from '../components/photoVault/PhotoVaultViewer';
import { Icon } from '../components/ui/Icon';
import {
  addGalleryPhoto,
  claimGalleryPhotoForViewer,
  getGalleryState,
  loadGallery,
  markGalleryPhotoRendered,
  markViewerPhotoRendered,
  mountGalleryPhoto,
  releaseGalleryPhotoFromViewer,
  removeGalleryPhoto,
  subscribeToGallery,
  unmountGalleryPhoto,
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
  const { status, lastIssue, unlock, lock } = usePhotoVault();

  const [gallery, setGallery] = useState<GalleryState>(getGalleryState);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const handlePicked = useCallback(
    async (outcome: PickerOutcome) => {
      setSheetOpen(false);

      switch (outcome.status) {
        case 'cancelled':
          return;
        case 'permissionDenied':
          setNotice(t('progress.photos.permission.libraryDenied'));
          return;
        case 'unsupported':
          setNotice(t('progress.photos.uploadError.unsupported'));
          return;
        case 'failed':
          setNotice(t('progress.photos.uploadError.generic'));
          return;
        default:
          break;
      }

      setNotice(null);
      // The controller owns this vault-temp URI from this point onward. It
      // keeps it only as an optimistic preview and removes it after the
      // encrypted thumbnail arrives, or immediately on failure/lock/logout.
      const ok = await addGalleryPhoto({
        sourceUri: outcome.sourceUri,
        takenAt: outcome.takenAt,
        originalMimeType: outcome.mimeType,
        width: outcome.width,
        height: outcome.height,
      });
      if (!ok) setNotice(uploadErrorMessage(getGalleryState().issue));
    },
    [t, uploadErrorMessage],
  );

  const handleCamera = useCallback(async () => {
    const outcome = await takePhotoWithCamera();
    if (outcome.status === 'permissionDenied') {
      setSheetOpen(false);
      setNotice(t('progress.photos.permission.cameraDenied'));
      return;
    }
    await handlePicked(outcome);
  }, [handlePicked, t]);

  const handleLibrary = useCallback(async () => {
    await handlePicked(await pickPhotoFromLibrary());
  }, [handlePicked]);

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
                if (!ok) setNotice(t('progress.photos.delete.error'));
              })();
            },
          },
        ],
      );
    },
    [handleCloseViewer, t],
  );

  // ── Locked ───────────────────────────────────────────────────────────────
  // Nothing about the vault's contents is rendered before this point.
  if (!unlocked) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        {pageHeader}
        <PhotoVaultLockedState
          status={status === 'authenticating' ? 'authenticating' : 'locked'}
          issue={lastIssue}
          onUnlock={() => void unlock()}
        />
        {pageFooter}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <PhotoVaultGrid
        photos={gallery.status === 'ready' ? gallery.photos : []}
        onVisible={mountGalleryPhoto}
        onHidden={unmountGalleryPhoto}
        onOpen={handleOpenViewer}
        onRendered={markGalleryPhotoRendered}
        formatDate={formatDate}
        listHeader={(
          <>
            {pageHeader}
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
            ) : gallery.photos.length === 0 ? (
              <PhotoVaultEmptyState onAdd={() => setSheetOpen(true)} />
            ) : null}
          </>
        )}
        listFooter={(
          <>
            {gallery.status === 'ready' && gallery.photos.length > 0 ? (
              <View style={{ paddingHorizontal: 22, paddingTop: 14 }}>
                <Pressable
                  onPress={() => setSheetOpen(true)}
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
        onClose={() => setSheetOpen(false)}
        onCamera={() => void handleCamera()}
        onLibrary={() => void handleLibrary()}
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
