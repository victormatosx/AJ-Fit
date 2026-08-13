import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';
import type { GalleryPhoto } from '../../lib/photoVaultGallery';

/**
 * Full-screen viewer for one decrypted photo.
 *
 * Renders only while a photo with a live URI is supplied. The parent drops
 * that URI the moment the vault locks, so the viewer disappears with it —
 * there is no path where a decrypted image outlives the lock.
 *
 * The image is kept in a single `<Image>` with no cache configuration so
 * screenshot protection can later be added around this subtree without
 * restructuring it.
 */

interface Props {
  photo: GalleryPhoto | null;
  formatDate: (date: Date) => string;
  onClose: () => void;
  onDelete: (photoId: string) => void;
  onRendered: (photoId: string, fullRendered: boolean) => void;
  deleting: boolean;
}

export function PhotoVaultViewer({
  photo,
  formatDate,
  onClose,
  onDelete,
  onRendered,
  deleting,
}: Props) {
  const { t } = useTranslation('home');

  const displayUri = photo?.fullUri ?? photo?.thumbnailUri ?? photo?.previewUri ?? null;
  // The thumbnail opens immediately; full replaces it when its native decrypt finishes.
  const visible = photo !== null && displayUri !== null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
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
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('progress.photos.a11y.closeViewer')}
                hitSlop={12}
                style={{ padding: 6 }}
              >
                <Icon name="x" size={22} color={colors.text} />
              </Pressable>

              {photo ? (
                <Text style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 13 }}>
                  {formatDate(photo.takenAt)}
                </Text>
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

            {photo && displayUri ? (
              <Image
                source={{ uri: displayUri }}
                resizeMode="contain"
                onLoad={() => {
                  onRendered(photo.photoId, photo.fullUri === displayUri);
                }}
                accessibilityRole="image"
                accessibilityLabel={t('progress.photos.a11y.photo', {
                  date: formatDate(photo.takenAt),
                })}
                style={{ flex: 1, width: '100%' }}
              />
            ) : null}

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
    </Modal>
  );
}
