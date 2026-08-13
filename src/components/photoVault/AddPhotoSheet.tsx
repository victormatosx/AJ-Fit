import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';

/**
 * Bottom sheet offering the two ways to add a photo.
 *
 * Neither option requests a permission on mount: the camera and library
 * permissions are only asked for after the user picks that specific option
 * (see services/photoVaultPicker).
 */

interface Props {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onLibrary: () => void;
}

function SheetOption({
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  icon: 'camera' | 'plus';
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 18,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
      }}
    >
      <Icon name={icon} size={20} color={colors.text} />
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function AddPhotoSheet({ visible, onClose, onCamera, onLibrary }: Props) {
  const { t } = useTranslation('home');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('progress.photos.add.cancel')}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
      >
        {/* Stops taps inside the sheet from dismissing it. */}
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: colors.bg2,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={{ padding: 20, gap: 12 }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.text,
                  fontFamily: fonts.uiSemi,
                  fontSize: 16,
                  marginBottom: 4,
                }}
              >
                {t('progress.photos.add.title')}
              </Text>

              <SheetOption
                icon="camera"
                label={t('progress.photos.add.camera')}
                accessibilityLabel={t('progress.photos.a11y.takePhoto')}
                onPress={onCamera}
              />
              <SheetOption
                icon="plus"
                label={t('progress.photos.add.library')}
                accessibilityLabel={t('progress.photos.a11y.chooseLibrary')}
                onPress={onLibrary}
              />

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('progress.photos.add.cancel')}
                style={{ paddingVertical: 16, alignItems: 'center' }}
              >
                <Text
                  style={{ color: colors.textSecondary, fontFamily: fonts.ui, fontSize: 14 }}
                >
                  {t('progress.photos.add.cancel')}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
