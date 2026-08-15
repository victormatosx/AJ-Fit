import React, { memo, useEffect, type ReactElement } from 'react';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { colors, fonts, sizes, spacing } from '../../theme/tokens';
import type { GalleryPhoto } from '../../lib/photoVaultGallery';

/**
 * Grid of private photos.
 *
 * Uses React Native's own `Image` rather than `expo-image`: the latter's
 * disk cache would copy decrypted photos into a durable cache outside the
 * vault's control, which is exactly what the whole design avoids. The URI it
 * receives is either an in-memory `data:` thumbnail or a short-lived file for
 * the legacy full fallback — this component never inspects which, and never
 * builds a path of its own.
 *
 * Presentation only. Every callback below belongs to the gallery controller:
 * `onVisible`/`onHidden` drive the download queue and the session LRU, and
 * `onRendered` closes the render-ready timing. Dropping any of them would
 * silently break prefetching, eviction or telemetry.
 */

const CELL_HEIGHT = 214;

interface Props {
  photos: GalleryPhoto[];
  /** Asks the controller to fetch and decrypt a photo that scrolled in. */
  onVisible: (photoId: string) => void;
  /** Releases render ownership; the bounded session LRU may retain it. */
  onHidden: (photoId: string) => void;
  onOpen: (photoId: string) => void;
  onRendered: (photoId: string) => void;
  formatDate: (date: Date) => string;
  listHeader?: ReactElement | null;
  listFooter?: ReactElement | null;
}

function PhotoCell({
  photo,
  onVisible,
  onHidden,
  onOpen,
  onRendered,
  formatDate,
}: {
  photo: GalleryPhoto;
  onVisible: (photoId: string) => void;
  onHidden: (photoId: string) => void;
  onOpen: (photoId: string) => void;
  onRendered: (photoId: string) => void;
  formatDate: (date: Date) => string;
}) {
  const { t } = useTranslation('home');
  const label = formatDate(photo.takenAt);
  const displayUri = photo.thumbnailUri ?? photo.previewUri;
  const canOpen = displayUri !== null && photo.uploadStatus === null;
  const uploading = photo.uploadStatus === 'uploading';

  // FlatList's bounded render window doubles as controlled prefetch. Leaving
  // it cancels queued work; already-ready thumbnails enter the bounded
  // session LRU and still disappear on lock/logout.
  useEffect(() => {
    onVisible(photo.photoId);
    return () => onHidden(photo.photoId);
  }, [photo.photoId, onVisible, onHidden]);

  return (
    <Pressable
      onPress={() => canOpen && onOpen(photo.photoId)}
      disabled={!canOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel={t('progress.photos.a11y.photo', { date: label })}
      accessibilityHint={
        canOpen ? t('progress.photos.a11y.openPhoto', { date: label }) : undefined
      }
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: sizes.hairline,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {displayUri ? (
        <Image
          source={{ uri: displayUri }}
          resizeMode="cover"
          onLoad={() => onRendered(photo.photoId)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      ) : photo.thumbnailLoading ? (
        <View
          testID="photo-vault-thumbnail-skeleton"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surfaceRaised,
          }}
        />
      ) : photo.failed ? (
        <View style={{ paddingHorizontal: spacing[3], alignItems: 'center', gap: spacing[2] }}>
          <Icon name="alert-triangle" size={16} color={colors.faint} />
          <Text
            style={{
              color: colors.faint,
              fontFamily: fonts.ui,
              fontSize: 11,
              lineHeight: 15,
              textAlign: 'center',
            }}
          >
            {t('progress.photos.list.offlinePhoto')}
          </Text>
        </View>
      ) : (
        <Icon name="camera" size={24} color={colors.faint} />
      )}

      {/* Scrim so the date stays legible over any photo, without a pill. */}
      {displayUri ? (
        <LinearGradient
          colors={['transparent', 'rgba(2,0,16,0.85)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 72 }}
        />
      ) : null}

      {uploading ? (
        <View
          style={{
            position: 'absolute',
            top: spacing[2.5],
            left: spacing[2.5],
            right: spacing[2.5],
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.mono,
              fontSize: 9,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            {photo.uploadProgress !== null && photo.uploadProgress > 0
              ? `${Math.round(photo.uploadProgress * 100)}%`
              : t('progress.photos.add.uploading')}
          </Text>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.accentHi,
            }}
          />
        </View>
      ) : null}

      <Text
        style={{
          position: 'absolute',
          bottom: spacing[3],
          left: spacing[3],
          color: colors.text,
          fontFamily: fonts.mono,
          fontSize: 9.5,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const MemoPhotoCell = memo(PhotoCell);

export function PhotoVaultGrid({
  photos,
  onVisible,
  onHidden,
  onOpen,
  onRendered,
  formatDate,
  listHeader = null,
  listFooter = null,
}: Props) {
  return (
    <FlatList
      testID="photo-vault-grid"
      data={photos}
      numColumns={2}
      keyExtractor={(photo) => photo.photoId}
      renderItem={({ item }) => (
        <MemoPhotoCell
          photo={item}
          onVisible={onVisible}
          onHidden={onHidden}
          onOpen={onOpen}
          onRendered={onRendered}
          formatDate={formatDate}
        />
      )}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      columnWrapperStyle={{ paddingHorizontal: sizes.screenGutter, gap: spacing[2.5] }}
      contentContainerStyle={{ paddingBottom: spacing[3], gap: spacing[2.5] }}
      initialNumToRender={6}
      maxToRenderPerBatch={4}
      updateCellsBatchingPeriod={50}
      // Current viewport plus a small adjacent window: useful prefetch without
      // walking the whole private gallery.
      windowSize={3}
      removeClippedSubviews={Platform.OS === 'android'}
      showsVerticalScrollIndicator={false}
    />
  );
}
