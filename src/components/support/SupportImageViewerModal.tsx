import { Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { spacing } from '../../theme/tokens';

/** Full-screen viewer for a received chat/reply attachment, opened by tapping its inline thumbnail. */
export function SupportImageViewerModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { t } = useTranslation('support');

  return (
    <Modal visible={url !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('detail.closeImage')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(2,0,16,0.94)' }}
      >
        {url && <Image source={{ uri: url }} contentFit="contain" style={{ flex: 1 }} />}
        <SafeAreaView style={{ position: 'absolute', top: 0, right: 0 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('detail.closeImage')}
            onPress={onClose}
            hitSlop={8}
            style={{
              margin: spacing[4],
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.14)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="x" size={20} color="#fff" />
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}
