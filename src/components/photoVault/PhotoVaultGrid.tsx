import React, { memo, useEffect, type ReactElement } from 'react';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { HudCorners } from '../ui/Card';
import { colors, fonts } from '../../theme/tokens';
import type { GalleryPhoto } from '../../lib/photoVaultGallery';

/**
 * Grid of private photos.
 *
 * Uses React Native's own `Image` rather than `expo-image`: the latter's
 * disk cache would copy decrypted photos into a durable cache outside the
 * vault's control, which is exactly what the whole design avoids. These
 * images come from short-lived temporary files and must disappear with them.
 */

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
        height: 190,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <HudCorners />

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
            backgroundColor: 'rgba(255,255,255,0.055)',
          }}
        />
      ) : photo.failed ? (
        <View style={{ paddingHorizontal: 12 }}>
          <Text
            style={{
              color: colors.faint,
              fontFamily: fonts.ui,
              fontSize: 11,
              textAlign: 'center',
            }}
          >
            {t('progress.photos.list.offlinePhoto')}
          </Text>
        </View>
      ) : (
        <Icon name="camera" size={28} color="rgba(255,255,255,0.2)" />
      )}

      {photo.uploadStatus === 'uploading' ? (
        <View
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            borderRadius: 8,
            backgroundColor: 'rgba(2,0,16,0.8)',
            paddingHorizontal: 8,
            paddingVertical: 5,
          }}
        >
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 11 }}>
            {photo.uploadProgress !== null && photo.uploadProgress > 0
              ? `${Math.round(photo.uploadProgress * 100)}%`
              : t('progress.photos.add.uploading')}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          backgroundColor: 'rgba(2,0,16,0.75)',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: '#fff', fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
      </View>
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
      columnWrapperStyle={{ paddingHorizontal: 22, gap: 12 }}
      contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
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
