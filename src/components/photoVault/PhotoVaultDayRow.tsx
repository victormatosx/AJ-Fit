import React, { memo, useEffect } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { MonoLabel } from '../ui/Display';
import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type {
  GalleryPhoto,
  GalleryThumbnailOwner,
} from '../../lib/photoVaultGallery';
import {
  POSE_SLOTS,
  type ProgressDay,
  type ProgressPhotoFilter,
} from '../../lib/photoVaultDayGrouping';
import type { ProgressPhotoPose } from '../../lib/photoVaultIdentity';

/**
 * One day of the private gallery.
 *
 * Presentation only. Every photo still flows through the existing thumbnail
 * pipeline — `onVisible`/`onHidden` per cell drive the download queue and the
 * session LRU exactly as before, so grouping three cells into a row does not
 * make the row fetch three thumbnails eagerly. Full images are never used
 * here.
 */

const CELL_HEIGHT = 148;

interface Props {
  day: ProgressDay;
  /**
   * Which poses this row shows. Under a pose filter the row renders that one
   * photo and no placeholders — offering to fill `side` while the user asked
   * to see `front` would be noise.
   */
  filter: ProgressPhotoFilter;
  onVisible: (photoId: string) => GalleryThumbnailOwner;
  onHidden: (owner: GalleryThumbnailOwner) => void;
  onOpen: (photoId: string) => void;
  onAddPose: (pose: ProgressPhotoPose) => void;
  onRendered: (photoId: string) => void;
  onRetrySync: (photoId: string) => void;
  formatDay: (date: Date) => string;
  formatMonth: (date: Date) => string;
}

function PhotoCell({
  photo,
  onVisible,
  onHidden,
  onOpen,
  onRendered,
  onRetrySync,
  label,
}: {
  photo: GalleryPhoto;
  onVisible: (photoId: string) => GalleryThumbnailOwner;
  onHidden: (owner: GalleryThumbnailOwner) => void;
  onOpen: (photoId: string) => void;
  onRendered: (photoId: string) => void;
  onRetrySync: (photoId: string) => void;
  label: string;
}) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const displayUri = photo.thumbnailUri ?? photo.previewUri;
  const canOpen = displayUri !== null && photo.uploadStatus === null;
  /**
   * The three save states, kept deliberately quiet.
   *
   * `preparing` is the only one the user is actually waiting on; the other two
   * describe a photo that is already safely on the device, so they must read
   * as status rather than as a warning. In particular `failed` must never look
   * like the photo was lost — it was not, and a retry is already scheduled.
   */
  const preparing = photo.uploadStatus === 'preparing';
  const uploading = photo.uploadStatus === 'uploading';
  const syncFailed = photo.uploadStatus === 'failed';
  const syncing = preparing || uploading;

  // The bounded render window of the surrounding list doubles as controlled
  // prefetch. Leaving it cancels queued work; a ready thumbnail stays in the
  // bounded session LRU and still disappears on lock.
  useEffect(() => {
    const owner = onVisible(photo.photoId);
    return () => onHidden(owner);
  }, [photo.photoId, onVisible, onHidden]);

  return (
    <Pressable
      onPress={() => canOpen && onOpen(photo.photoId)}
      disabled={!canOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: sizes.hairline,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {displayUri ? (
        <PhotoImage uri={displayUri} onLoad={() => onRendered(photo.photoId)} />
      ) : photo.thumbnailLoading ? (
        <View
          testID="photo-vault-thumbnail-skeleton"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.surfaceElevated }}
        />
      ) : photo.failed ? (
        <Icon name="alert-triangle" size={15} color={theme.colors.textFaint} />
      ) : (
        <Icon name="camera" size={18} color={theme.colors.textFaint} />
      )}

      {syncing ? (
        <View style={{ position: 'absolute', top: spacing[2], left: spacing[2] }}>
          <Text
            testID={`photo-vault-sync-${photo.photoId}`}
            style={{
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.mono,
              fontSize: 8.5,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {preparing
              ? t('progress.photos.sync.preparing')
              : photo.uploadProgress !== null && photo.uploadProgress > 0
                ? `${Math.round(photo.uploadProgress * 100)}%`
                : t('progress.photos.sync.pending')}
          </Text>
        </View>
      ) : null}

      {/* A delivery that failed offers a retry in place. The photo itself is
          safe on the device, so this is an action, not an error state. */}
      {syncFailed ? (
        <Pressable
          onPress={() => onRetrySync(photo.photoId)}
          accessibilityRole="button"
          accessibilityLabel={t('progress.photos.a11y.retrySync')}
          testID={`photo-vault-retry-${photo.photoId}`}
          hitSlop={6}
          style={{
            position: 'absolute',
            top: spacing[2],
            left: spacing[2],
            right: spacing[2],
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[1],
          }}
        >
          <Icon name="alert-triangle" size={9} color={theme.colors.warning} />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.mono,
              fontSize: 8.5,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {t('progress.photos.sync.retry')}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** Split out so the scrim only renders when there is actually an image. */
function PhotoImage({ uri, onLoad }: { uri: string; onLoad: () => void }) {
  return (
    <>
      <Image
        source={{ uri }}
        resizeMode="cover"
        onLoad={onLoad}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <LinearGradient
        colors={['transparent', 'rgba(2,0,16,0.7)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 48 }}
      />
    </>
  );
}

/**
 * A pose with no photo yet.
 *
 * Tapping it opens the new-photo flow with that pose pre-selected. Only the
 * POSE is carried over — the day comes from the photo the user then picks, so
 * choosing a July picture from this slot still files it under July.
 */
function EmptySlot({ label, onPress, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 10,
        borderWidth: sizes.hairline,
        borderColor: theme.colors.border,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="plus" size={13} color={theme.colors.textFaint} />
      <MonoLabel size={8} style={{ marginTop: spacing[1] }}>{label}</MonoLabel>
    </Pressable>
  );
}

function PhotoVaultDayRowComponent({
  day,
  filter,
  onVisible,
  onHidden,
  onOpen,
  onAddPose,
  onRendered,
  onRetrySync,
  formatDay,
  formatMonth,
}: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  // Static lookup rather than a template key: the translation keys are typed,
  // and a composed key would silently escape that check.
  const poseLabels: Record<ProgressPhotoPose, string> = {
    front: t('progress.photos.poses.front'),
    side: t('progress.photos.poses.side'),
    back: t('progress.photos.poses.back'),
  };

  return (
    <View>
      {day.startsMonth ? (
        <View
          style={{
            paddingHorizontal: sizes.screenGutter,
            paddingTop: spacing[5],
            paddingBottom: spacing[3],
          }}
        >
          <MonoLabel color={theme.colors.textMuted}>{formatMonth(day.date).toUpperCase()}</MonoLabel>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[5] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing[2.5],
          }}
        >
          <MonoLabel color={theme.colors.textPrimary}>{formatDay(day.date).toUpperCase()}</MonoLabel>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {(filter === 'all' ? POSE_SLOTS : [filter]).map((pose) => {
            const photo = day[pose];
            if (!photo && filter !== 'all') return null;
            return photo ? (
              <PhotoCell
                key={pose}
                photo={photo}
                onVisible={onVisible}
                onHidden={onHidden}
                onOpen={onOpen}
                onRendered={onRendered}
                onRetrySync={onRetrySync}
                label={t('progress.photos.a11y.posePhoto', {
                  pose: poseLabels[pose],
                  date: formatDay(day.date),
                })}
              />
            ) : (
              <EmptySlot
                key={pose}
                label={poseLabels[pose].toUpperCase()}
                onPress={() => onAddPose(pose)}
                accessibilityLabel={t('progress.photos.a11y.addPose', {
                  pose: poseLabels[pose],
                  date: formatDay(day.date),
                })}
              />
            );
          })}
        </View>

        {day.unclassified.length > 0 ? (
          <View style={{ marginTop: spacing[3] }}>
            <MonoLabel size={9} style={{ marginBottom: spacing[2] }}>
              {t('progress.photos.day.unclassified').toUpperCase()}
            </MonoLabel>
            <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
              {day.unclassified.map((photo) => (
                <View key={photo.photoId} style={{ width: '31.5%' }}>
                  <PhotoCell
                    photo={photo}
                    onVisible={onVisible}
                    onHidden={onHidden}
                    onOpen={onOpen}
                    onRendered={onRendered}
                    onRetrySync={onRetrySync}
                    label={t('progress.photos.a11y.photo', { date: formatDay(day.date) })}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const PhotoVaultDayRow = memo(PhotoVaultDayRowComponent);
